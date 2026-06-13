/* ============================================
   OWNER REPORT - Assessment orchestrator
   backfill() and run() produce a FarmAssessment:
   the single JSON contract the report layer
   consumes. Progress via onStatus callback.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Assessment = {
    /** Backfill the farm timeseries from Config.backfillStart to today. */
    async backfill(farm, onStatus) {
        const C = FunMap.Owner.Config;
        const DB = FunMap.Owner.DB;
        const today = FunMap.Utils.toISODate(new Date());
        const startFrom = farm.backfilledTo
            ? FunMap.Utils.toISODate(new Date(new Date(farm.backfilledTo).getTime() + 86400000))
            : C.backfillStart;
        if (startFrom > today) return 0;

        let added = 0;
        let from = startFrom;
        while (from <= today) {
            const fromYear = parseInt(from.split('-')[0], 10);
            const chunkEnd = `${fromYear}-12-31` < today ? `${fromYear}-12-31` : today;
            if (onStatus) onStatus(`Fetching ${fromYear} statistics...`);
            const rows = await FunMap.Owner.S2.fetchTimeseries(farm.bufferedRing, from, chunkEnd);
            for (const row of rows) {
                await DB.put('timeseries', {
                    key: `${farm.id}|${row.date}`, farmId: farm.id, ...row,
                });
                added++;
            }
            from = `${fromYear + 1}-01-01`;
        }
        farm.backfilledTo = today;
        await DB.put('farms', farm);
        return added;
    },

    async getTimeseries(farmId) {
        const rows = await FunMap.Owner.DB.getAllByIndex('timeseries', 'farmId', farmId);
        return rows.sort((a, b) => a.date.localeCompare(b.date));
    },

    /** Full assessment for a report month ("YYYY-MM"). */
    async run(farm, monthStr, onStatus) {
        const C = FunMap.Owner.Config;
        const B = FunMap.Owner.Baselines;
        const G = FunMap.Owner.Geometry;
        const say = onStatus || (() => {});

        // 1. Timeseries up to date
        say('Updating field history...');
        await this.backfill(farm, onStatus);
        const allRows = await this.getTimeseries(farm.id);
        const valid = B.validRows(allRows, C.minValidFraction);

        const [y, m] = monthStr.split('-').map(Number);
        const windowFrom = `${monthStr}-01`;
        const windowTo = FunMap.Utils.toISODate(new Date(Math.min(Date.now(), new Date(y, m, 0).getTime())));
        const windowCenter = `${monthStr}-15`;

        // 2. Analysis grid + land-cover gate (§7)
        const bbox = G.bbox(farm.ring, C.rasterPadDeg);
        const width = Math.max(16, Math.round((bbox[2] - bbox[0]) / C.rasterResDeg));
        const height = Math.max(16, Math.round((bbox[3] - bbox[1]) / C.rasterResDeg));
        const boundaryMask = G.rasterMask(farm.bufferedRing, bbox, width, height);

        const lc = await FunMap.Owner.LandCover.ensure(
            farm, { bbox, width, height, mask: boundaryMask }, say);
        if (lc.blocked) {
            throw new Error(`Boundary appears to be only ${Math.round(lc.croplandShare * 100)}% cropland — ` +
                'retrace it (REDRAW) or confirm the land cover (LAND OK) before running a report.');
        }
        const mask = lc.maskApplied
            ? boundaryMask.map((v, i) => v && lc.cropMask[i] ? 1 : 0)
            : boundaryMask;
        let analyzedPixels = 0;
        for (let i = 0; i < mask.length; i++) if (mask[i]) analyzedPixels++;
        const analyzedAcres = Math.round(analyzedPixels * G.pixelAreaM2(bbox, width, height) * 0.0247105) / 100;

        // 3. Verdict inputs (self history: full buffered polygon, consistent across years)
        const current = B.currentValue(valid, windowFrom, windowTo, 3);
        const selfBase = B.selfBaseline(valid, windowCenter, 20, y);

        // 4. Sub-field anomalies over the most recent valid dates
        say('Scanning for sub-field anomalies...');
        const anomalyDates = valid.slice(-C.anomaly.analysisDates).map(r => r.date);
        const rasters = [];
        for (const date of anomalyDates) {
            try {
                const r = await FunMap.Owner.S2.fetchNdviRaster(bbox, date, width, height);
                rasters.push({ date, data: r.data });
            } catch (e) { /* skip failing date */ }
        }
        const layer = rasters.length >= C.anomaly.minConsecutiveDates
            ? FunMap.Owner.Anomaly.detect(rasters, mask, bbox, width, height, C.anomaly)
            : null;
        const flagResult = layer
            ? FunMap.Owner.Flags.build(layer, farm.ring, farm.acreage,
                Object.assign({}, C.anomaly, C.flags))
            : { flags: [], overlayFlags: [], summary: '', flaggedAcres: 0, flaggedShare: 0 };

        // 5. Neighbor benchmark (§5): manual comps first, else cropland ring
        say('Benchmarking against nearby fields...');
        let neighbor = null, neighborSource = null, neighborFieldMean = null;
        if (farm.comparisonRings && farm.comparisonRings.length > 0) {
            const rowsPerComp = [];
            for (const ring of farm.comparisonRings) {
                try {
                    rowsPerComp.push(await FunMap.Owner.S2.fetchTimeseries(ring, windowFrom, windowTo));
                } catch (e) { /* skip failing comp */ }
            }
            neighbor = B.neighborBenchmark(rowsPerComp, windowFrom, windowTo, C.minValidFraction);
            if (neighbor) neighborSource = 'manual-comps';
        } else if (rasters.length > 0) {
            try {
                const pairRasters = rasters.filter(r => r.date >= windowFrom && r.date <= windowTo).slice(-3);
                const ringBench = await FunMap.Owner.Neighbor.benchmark(
                    farm, pairRasters.length ? pairRasters : rasters.slice(-3), mask, say);
                if (ringBench) {
                    neighbor = { mean: ringBench.mean, nSamples: ringBench.nSamples };
                    neighborSource = 'ring-proxy';
                    neighborFieldMean = ringBench.fieldMean;   // same-scene pairing
                }
            } catch (e) { /* omit silently per spec */ }
        }

        // 6. Weather context
        say('Adding weather context...');
        let weather = null;
        try { weather = await FunMap.Owner.Weather.monthContext(farm, monthStr); }
        catch (e) { /* report degrades gracefully without weather */ }

        // 7. Report images
        say('Rendering report imagery...');
        const assessmentId = FunMap.Utils.uid();
        const latestRaster = rasters.length
            ? { data: rasters[rasters.length - 1].data, width, height, bbox } : null;
        const images = await FunMap.Owner.Render.buildReportImages(
            farm, bbox, current ? current.latestDate : null,
            latestRaster, mask, flagResult.overlayFlags, assessmentId);

        // 8. Verdict (single source of truth) + evidence-gated cause
        const windowValid = valid.filter(r => r.date >= windowFrom && r.date <= windowTo);
        const meanTier = B.verdictTier(current ? current.mean : null, selfBase, C.verdict);
        const causeKey = FunMap.Owner.Cause.assign(weather, m, current ? current.mean : null, C.cause);
        const decided = FunMap.Owner.Verdict.derive({
            meanTier, flaggedShare: flagResult.flaggedShare,
            validScenes: windowValid.length, hasFlags: flagResult.flags.length > 0,
        }, C);
        const flagsOut = decided.tier === 'limited_visibility'
            ? [] : flagResult.flags.map(f => Object.assign({}, f, { causeKey }));

        const round3 = v => Math.round(v * 1000) / 1000;
        const fieldForNeighbor = neighborFieldMean !== null
            ? neighborFieldMean : (current ? current.mean : null);

        const assessment = {
            id: assessmentId, farmId: farm.id, firmId: farm.firmId,
            month: monthStr, generatedAt: new Date().toISOString(), version: C.version,
            verdict: {
                tier: decided.tier, meanTier, capped: decided.capped,
                acknowledgesFlags: decided.acknowledgesFlags,
                flagCount: flagsOut.length,
                flaggedAcres: flagResult.flaggedAcres,
                flaggedShare: round3(flagResult.flaggedShare),
                currentMean: current ? round3(current.mean) : null,
                selfBaseline: selfBase ? {
                    mean: round3(selfBase.mean), std: round3(selfBase.std), years: selfBase.years,
                } : null,
                pctVsSelf: current && selfBase ? Math.round(current.mean / selfBase.mean * 100) : null,
                neighborMean: neighbor ? round3(neighbor.mean) : null,
                pctVsNeighbor: neighbor && fieldForNeighbor !== null
                    ? Math.round(fieldForNeighbor / neighbor.mean * 100) : null,
                neighborSamples: neighbor ? (neighbor.nSamples || neighbor.nComps || 0) : 0,
            },
            neighborSource: neighborSource,
            landCover: {
                source: lc.source, year: lc.year, croplandShare: lc.croplandShare,
                maskApplied: lc.maskApplied, confirmed: !!farm.landCoverConfirmed,
            },
            observations: {
                latestDate: current ? current.latestDate : null,
                windowDates: current ? current.dates : [],
                anomalyDates: anomalyDates,
                validScenesInWindow: windowValid.length,
                totalValidDates: valid.length,
            },
            scenesTable: B.sceneTable(allRows, windowFrom, windowTo, C.minValidFraction),
            analyzedAcres: analyzedAcres,
            analyzedPixels: analyzedPixels,
            flags: flagsOut,
            flagSummary: decided.tier === 'limited_visibility' ? null : flagResult.summary,
            weather: weather,
            images: images,
            sparkline: valid.slice(-24).map(r => ({ date: r.date, v: round3(r.ndviMean) })),
        };

        await FunMap.Owner.DB.put('assessments', assessment);
        farm.lastAssessmentId = assessment.id;
        await FunMap.Owner.DB.put('farms', farm);
        return assessment;
    },

    async getAssessment(id) { return FunMap.Owner.DB.get('assessments', id); },
    async getImageBlob(key) { return key ? FunMap.Owner.DB.get('images', key) : null; },
};
