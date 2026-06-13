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

        // 2. Verdict inputs
        const current = B.currentValue(valid, windowFrom, windowTo, 3);
        const selfBase = B.selfBaseline(valid, windowCenter, 20, y);

        say('Benchmarking against nearby fields...');
        let neighbor = null;
        if (farm.comparisonRings && farm.comparisonRings.length > 0) {
            const rowsPerComp = [];
            for (const ring of farm.comparisonRings) {
                try {
                    rowsPerComp.push(await FunMap.Owner.S2.fetchTimeseries(ring, windowFrom, windowTo));
                } catch (e) { /* skip failing comp */ }
            }
            neighbor = B.neighborBenchmark(rowsPerComp, windowFrom, windowTo, C.minValidFraction);
        }

        // 3. Sub-field anomalies over the most recent valid dates
        say('Scanning for sub-field anomalies...');
        const bbox = G.bbox(farm.ring, C.rasterPadDeg);
        const width = Math.max(16, Math.round((bbox[2] - bbox[0]) / C.rasterResDeg));
        const height = Math.max(16, Math.round((bbox[3] - bbox[1]) / C.rasterResDeg));
        const mask = G.rasterMask(farm.bufferedRing, bbox, width, height);

        const anomalyDates = valid.slice(-C.anomaly.analysisDates).map(r => r.date);
        const rasters = [];
        for (const date of anomalyDates) {
            try {
                const r = await FunMap.Owner.S2.fetchNdviRaster(bbox, date, width, height);
                rasters.push({ date, data: r.data });
            } catch (e) { /* skip failing date */ }
        }
        const detection = rasters.length >= C.anomaly.minConsecutiveDates
            ? FunMap.Owner.Anomaly.detect(rasters, mask, bbox, width, height, farm.ring, C.anomaly)
            : { flags: [] };

        // 4. Weather context
        say('Adding weather context...');
        let weather = null;
        try { weather = await FunMap.Owner.Weather.monthContext(farm, monthStr); }
        catch (e) { /* report degrades gracefully without weather */ }

        // 5. Report images
        say('Rendering report imagery...');
        const images = { heroKey: null, anomalyKey: null };
        const assessmentId = FunMap.Utils.uid();
        if (current) {
            try {
                const dims = this._heroDims(bbox);
                const png = await FunMap.Owner.S2.fetchRenderPng(bbox, current.latestDate, dims.w, dims.h);
                const hero = await FunMap.Owner.Render.heroImage(png, farm.ring, bbox);
                images.heroKey = `img|${assessmentId}|hero`;
                await FunMap.Owner.DB.put('images', hero, images.heroKey);
            } catch (e) { /* hero optional */ }
        }
        if (rasters.length > 0) {
            try {
                const latest = rasters[rasters.length - 1];
                const overlay = await FunMap.Owner.Render.anomalyOverlay(
                    { data: latest.data, width, height, bbox }, mask, detection.flags, farm.ring);
                images.anomalyKey = `img|${assessmentId}|anomaly`;
                await FunMap.Owner.DB.put('images', overlay, images.anomalyKey);
            } catch (e) { /* overlay optional */ }
        }

        // 6. Assemble the FarmAssessment contract
        const tier = B.verdictTier(current ? current.mean : null, selfBase, C.verdict);
        const assessment = {
            id: assessmentId,
            farmId: farm.id,
            firmId: farm.firmId,
            month: monthStr,
            generatedAt: new Date().toISOString(),
            verdict: {
                tier: tier,
                currentMean: current ? round3(current.mean) : null,
                selfBaseline: selfBase ? {
                    mean: round3(selfBase.mean), std: round3(selfBase.std), years: selfBase.years,
                } : null,
                pctVsSelf: current && selfBase ? Math.round(current.mean / selfBase.mean * 100) : null,
                neighborMean: neighbor ? round3(neighbor.mean) : null,
                pctVsNeighbor: current && neighbor ? Math.round(current.mean / neighbor.mean * 100) : null,
                nComps: neighbor ? neighbor.nComps : 0,
            },
            observations: {
                latestDate: current ? current.latestDate : null,
                windowDates: current ? current.dates : [],
                anomalyDates: anomalyDates,
                totalValidDates: valid.length,
            },
            flags: detection.flags.map(f => ({
                id: f.id, acres: f.acres, compass: f.compass, severity: f.severity,
                meanZ: f.meanZ, dates: f.dates, spanDays: f.spanDays, durationObs: f.durationObs,
                causeHint: this._causeHint(weather),
            })),
            weather: weather,
            images: images,
            sparkline: valid.slice(-24).map(r => ({ date: r.date, v: round3(r.ndviMean) })),
        };

        await FunMap.Owner.DB.put('assessments', assessment);
        farm.lastAssessmentId = assessment.id;
        await FunMap.Owner.DB.put('farms', farm);

        function round3(v) { return Math.round(v * 1000) / 1000; }
        return assessment;
    },

    _heroDims(bbox) {
        const C = FunMap.Owner.Config;
        const aspect = (bbox[2] - bbox[0]) * Math.cos((bbox[1] + bbox[3]) / 2 * Math.PI / 180) /
            (bbox[3] - bbox[1]);
        return aspect >= 1
            ? { w: C.heroImageMaxEdge, h: Math.round(C.heroImageMaxEdge / aspect) }
            : { w: Math.round(C.heroImageMaxEdge * aspect), h: C.heroImageMaxEdge };
    },

    _causeHint(weather) {
        const C = FunMap.Owner.Config;
        if (weather && weather.departureIn >= C.weatherWetDepartureIn) return 'ponding';
        if (weather && weather.departureIn <= C.weatherDryDepartureIn) return 'moisture_stress';
        return 'generic';
    },

    async getAssessment(id) { return FunMap.Owner.DB.get('assessments', id); },
    async getImageBlob(key) { return key ? FunMap.Owner.DB.get('images', key) : null; },
};
