/* ============================================
   OWNER REPORT - Land cover gate (§7)
   Cropland share decides: >=80% full analysis,
   40-80% cropland-masked analysis, <40% block.
   Source order: USDA CDL (CropScape, authoritative,
   best-effort — may be unreachable from a browser)
   -> temporal-signature proxy -> manager override.
   The appendix states which source ran.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.LandCover = {
    /**
     * Ensure farm.landCover exists (computed once, stored on the farm).
     * grid: { bbox, width, height, mask } — the farm's analysis grid.
     * Returns { source, year, croplandShare, blocked, maskApplied,
     *           cropMask (Uint8Array, transient), analyzedPixels }
     */
    async ensure(farm, grid, onStatus) {
        const C = FunMap.Owner.Config.landcover;
        const say = onStatus || (() => {});

        // Cached mask: reuse when the grid is unchanged and < 90 days old.
        const gridKey = `${grid.bbox.map(v => v.toFixed(5)).join(',')}|${grid.width}x${grid.height}`;
        if (farm.landCover && farm.landCover.gridKey === gridKey &&
            (Date.now() - new Date(farm.landCover.computedAt)) < 90 * 86400000) {
            const blob = await FunMap.Owner.DB.get('images', `lcmask|${farm.id}`);
            if (blob) {
                const cropMask = new Uint8Array(await blob.arrayBuffer());
                if (cropMask.length === grid.width * grid.height) {
                    // Re-derive gate state: a later manager confirmation
                    // must override a cached "blocked".
                    const cached = Object.assign({}, farm.landCover);
                    if (farm.landCoverConfirmed) {
                        cached.source = 'confirmed';
                        cached.blocked = false;
                        cached.maskApplied = false;
                    }
                    return Object.assign({ cropMask }, cached);
                }
            }
        }

        // The per-pixel mask always comes from the temporal proxy (the only
        // per-pixel source we have); CDL (when reachable) supplies the
        // authoritative SHARE for the gate decision.
        say('Classifying land cover...');
        const proxy = await this._proxyClassify(farm, grid);

        let source = 'proxy', year = null, share = proxy.share;
        if (this._inConus(farm.centroid)) {
            const cdl = await this._tryCDL(farm).catch(() => null);
            if (cdl) { source = 'cdl'; year = cdl.year; share = cdl.share; }
        }

        if (farm.landCoverConfirmed) source = 'confirmed';

        const blocked = !farm.landCoverConfirmed && share < C.blockShare;
        const maskApplied = !farm.landCoverConfirmed &&
            share < C.maskShare && share >= C.blockShare;

        const lc = {
            source, year,
            croplandShare: Math.round(share * 1000) / 1000,
            proxyShare: Math.round(proxy.share * 1000) / 1000,
            blocked, maskApplied,
            gridKey: gridKey,
            computedAt: new Date().toISOString(),
        };
        farm.landCover = lc;
        await FunMap.Owner.DB.put('farms', farm);
        await FunMap.Owner.DB.put('images', new Blob([proxy.cropMask]), `lcmask|${farm.id}`);

        // Store a small mask preview for the retrace prompt
        try {
            const blob = await FunMap.Owner.Render.landCoverPreview(
                proxy.cropMask, grid.mask, grid.width, grid.height, grid.bbox, farm.ring);
            await FunMap.Owner.DB.put('images', blob, `img|landcover|${farm.id}`);
        } catch (e) { /* preview optional */ }

        return Object.assign({ cropMask: proxy.cropMask }, lc);
    },

    /**
     * Temporal-signature proxy over the farm grid.
     * Cropland pixel = (NDVI amplitude >= amplitudeMin) AND
     * (some valid Apr-Oct observation with NDVI < bareSoilNdvi).
     */
    async _proxyClassify(farm, grid) {
        const C = FunMap.Owner.Config.landcover;
        const rows = await FunMap.Owner.Assessment.getTimeseries(farm.id);
        const valid = FunMap.Owner.Baselines.validRows(rows, FunMap.Owner.Config.minValidFraction);

        // Sample dates spread over the most recent ~14 months of history
        const recent = valid.slice(-60);
        const step = Math.max(1, Math.floor(recent.length / C.proxyDates));
        const dates = recent.filter((_, i) => i % step === 0).slice(-C.proxyDates).map(r => r.date);

        const rasters = [];
        for (const date of dates) {
            try {
                const r = await FunMap.Owner.S2.fetchNdviRaster(grid.bbox, date, grid.width, grid.height);
                rasters.push({ date, data: r.data });
            } catch (e) { /* skip */ }
        }
        return this.classifyPixels(rasters, grid.mask, grid.width * grid.height, C);
    },

    /** Pure per-pixel signature (Node-tested). */
    classifyPixels(rasters, mask, n, cfg) {
        const cropMask = new Uint8Array(n);
        if (rasters.length < 4) {
            // Not enough history to classify — pass everything through
            let inMask = 0;
            for (let i = 0; i < n; i++) if (mask[i]) { cropMask[i] = 1; inMask++; }
            return { cropMask, share: 1, classified: false };
        }
        const min = new Float32Array(n).fill(Infinity);
        const max = new Float32Array(n).fill(-Infinity);
        const bare = new Uint8Array(n);
        rasters.forEach(r => {
            const m = parseInt(r.date.split('-')[1], 10);
            const inSeason = m >= cfg.bareSoilMonths[0] && m <= cfg.bareSoilMonths[1];
            for (let i = 0; i < n; i++) {
                if (!mask[i]) continue;
                const v = r.data[i];
                if (isNaN(v)) continue;
                if (v < min[i]) min[i] = v;
                if (v > max[i]) max[i] = v;
                if (inSeason && v < cfg.bareSoilNdvi) bare[i] = 1;
            }
        });
        let inMask = 0, crop = 0;
        for (let i = 0; i < n; i++) {
            if (!mask[i]) continue;
            inMask++;
            if (max[i] - min[i] >= cfg.amplitudeMin && bare[i]) { cropMask[i] = 1; crop++; }
        }
        return { cropMask, share: inMask ? crop / inMask : 0, classified: true };
    },

    _inConus(centroid) {
        const b = FunMap.Owner.Config.landcover.conusBbox;
        return centroid[0] >= b[0] && centroid[0] <= b[2] &&
               centroid[1] >= b[1] && centroid[1] <= b[3];
    },

    /** Best-effort CropScape GetCDLStat (authoritative share). */
    async _tryCDL(farm) {
        const C = FunMap.Owner.Config.landcover;
        const year = new Date().getFullYear() - 1;
        const box = FunMap.Owner.Geometry.bbox(farm.ring);
        const [x1, y1] = this.toAlbers5070(box[0], box[1]);
        const [x2, y2] = this.toAlbers5070(box[2], box[3]);
        const url = 'https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLStat' +
            `?year=${year}&bbox=${Math.min(x1, x2).toFixed(0)},${Math.min(y1, y2).toFixed(0)},` +
            `${Math.max(x1, x2).toFixed(0)},${Math.max(y1, y2).toFixed(0)}&format=json`;

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), C.cdlTimeoutMs);
        try {
            const resp = await fetch(url, { signal: ctrl.signal });
            if (!resp.ok) return null;
            const text = await resp.text();
            const rows = this.parseCdlStats(text);
            if (!rows || rows.length === 0) return null;
            let total = 0, crop = 0;
            rows.forEach(r => {
                total += r.acreage;
                if (this.isCropCode(r.value, C.cdlCropRanges)) crop += r.acreage;
            });
            return total > 0 ? { year, share: crop / total } : null;
        } finally {
            clearTimeout(timer);
        }
    },

    /** Defensive parse: JSON rows or XML-ish "value, count, acreage" rows. */
    parseCdlStats(text) {
        try {
            const j = JSON.parse(text);
            const arr = Array.isArray(j) ? j : (j.rows || j.Results || j.result || null);
            if (Array.isArray(arr)) {
                return arr.map(r => ({
                    value: parseInt(r.value ?? r.Value ?? r.category, 10),
                    acreage: parseFloat(r.acreage ?? r.Acreage ?? r.acres ?? 0),
                })).filter(r => isFinite(r.value) && isFinite(r.acreage));
            }
        } catch (e) { /* fall through to row regex */ }
        const out = [];
        const re = /<Row>\s*(\d+)\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*<\/Row>/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
            out.push({ value: parseInt(m[1], 10), acreage: parseFloat(m[2]) });
        }
        return out;
    },

    isCropCode(code, ranges) {
        return ranges.some(([a, b]) => code >= a && code <= b);
    },

    /** EPSG:5070 (CONUS Albers, GRS80, spherical approximation). */
    toAlbers5070(lonDeg, latDeg) {
        const R = 6378137, d = Math.PI / 180;
        const lat0 = 23 * d, lon0 = -96 * d, sp1 = 29.5 * d, sp2 = 45.5 * d;
        const n = (Math.sin(sp1) + Math.sin(sp2)) / 2;
        const cBig = Math.cos(sp1) * Math.cos(sp1) + 2 * n * Math.sin(sp1);
        const rho = (lat) => R * Math.sqrt(cBig - 2 * n * Math.sin(lat)) / n;
        const theta = n * (lonDeg * d - lon0);
        const r = rho(latDeg * d), r0 = rho(lat0);
        return [r * Math.sin(theta), r0 - r * Math.cos(theta)];
    },
};
