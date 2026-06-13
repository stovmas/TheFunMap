/* ============================================
   OWNER REPORT - Neighbor benchmark (§5)
   Donut ring (~150m..3km) around the field,
   masked to cropland pixels via the same §7
   temporal signature; field and ring compared
   on IDENTICAL acquisition dates (same-scene
   pairing — required, do not relax in refactors).
   Omitted silently when evidence is insufficient.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Neighbor = {
    /**
     * Compute the ring benchmark for the field's window dates.
     * fieldRasters: [{date, data}] on the FIELD grid (for pairing).
     * fieldMask: cropland-and-boundary mask on the field grid.
     * Returns { mean, fieldMean, nSamples, nDates, source: 'ring-proxy' } or null.
     */
    async benchmark(farm, fieldRasters, fieldMask, onStatus) {
        const C = FunMap.Owner.Config;
        const NC = C.neighbor;
        const G = FunMap.Owner.Geometry;
        const say = onStatus || (() => {});
        if (!fieldRasters || fieldRasters.length === 0) return null;

        // Ring grid (~30m) over field bbox padded to the outer radius
        const padDeg = NC.outerRingM / 111320 * 1.05;
        const bbox = G.bbox(farm.ring, padDeg);
        const width = Math.min(400, Math.max(32, Math.round((bbox[2] - bbox[0]) / NC.ringResDeg)));
        const height = Math.min(400, Math.max(32, Math.round((bbox[3] - bbox[1]) / NC.ringResDeg)));
        const ringMask = this._ringMask(farm.ring, bbox, width, height, NC);
        const n = width * height;

        // Cropland-classify the ring with the SAME §7 signature
        say('Classifying surrounding cropland...');
        const rows = await FunMap.Owner.Assessment.getTimeseries(farm.id);
        const valid = FunMap.Owner.Baselines.validRows(rows, C.minValidFraction);
        const sigDates = valid.slice(-48).filter((_, i) => i % 4 === 0)
            .slice(-C.landcover.proxyDates).map(r => r.date);
        const sigRasters = [];
        for (const date of sigDates) {
            try {
                const r = await FunMap.Owner.S2.fetchNdviRaster(bbox, date, width, height);
                sigRasters.push({ date, data: r.data });
            } catch (e) { /* skip */ }
        }
        const cls = FunMap.Owner.LandCover.classifyPixels(sigRasters, ringMask, n, C.landcover);
        if (!cls.classified || cls.share < NC.minRingCroplandShare) return null;

        const cropRing = cls.cropMask;

        // Same-scene pairing: ring rasters on the exact field window dates
        say('Benchmarking against surrounding farms...');
        let ringSum = 0, ringCnt = 0, fieldSum = 0, fieldCnt = 0, nDates = 0;
        let sampleMin = Infinity;
        for (const fr of fieldRasters) {
            let r;
            try {
                r = await FunMap.Owner.S2.fetchNdviRaster(bbox, fr.date, width, height);
            } catch (e) { continue; }
            const rm = this._maskedMean(r.data, cropRing, n);
            const fm = this._maskedMean(fr.data, fieldMask, fr.data.length);
            if (!rm || !fm) continue;               // both sides must see this scene
            if (rm.count < NC.minMaskedPixels) { sampleMin = Math.min(sampleMin, rm.count); continue; }
            ringSum += rm.mean; fieldSum += fm.mean;
            ringCnt++; fieldCnt++; nDates++;
            sampleMin = Math.min(sampleMin, rm.count);
        }
        if (nDates === 0) return null;

        return {
            mean: ringSum / ringCnt,
            fieldMean: fieldSum / fieldCnt,
            nSamples: sampleMin === Infinity ? 0 : sampleMin,
            nDates: nDates,
            ringCroplandShare: Math.round(cls.share * 1000) / 1000,
            source: 'ring-proxy',
        };
    },

    /** Pure: mean over masked, valid pixels. Returns {mean,count} or null. */
    _maskedMean(data, mask, n) {
        let sum = 0, count = 0;
        for (let i = 0; i < n; i++) {
            if (mask[i] && !isNaN(data[i])) { sum += data[i]; count++; }
        }
        return count > 0 ? { mean: sum / count, count } : null;
    },

    /** Donut mask: inside outer radius, outside field+innerGap. Pure. */
    _ringMask(ring, bbox, width, height, NC) {
        const G = FunMap.Owner.Geometry;
        const mask = new Uint8Array(width * height);
        const c = G.centroid(ring);
        const cosLat = Math.cos(c[1] * Math.PI / 180);
        const fieldBox = G.bbox(ring);
        // inner exclusion = field polygon dilated by innerGapM (approx via
        // distance-to-bbox test + point-in-polygon for accuracy near edges)
        const gapDeg = NC.innerGapM / 111320;
        const outerM = NC.outerRingM;
        for (let r = 0; r < height; r++) {
            for (let col = 0; col < width; col++) {
                const p = G.pixelCenterLngLat(col, r, bbox, width, height);
                const dx = (p[0] - c[0]) * cosLat * 111320;
                const dy = (p[1] - c[1]) * 111320;
                if (Math.sqrt(dx * dx + dy * dy) > outerM) continue;
                // exclude the field itself plus the inner gap
                if (p[0] >= fieldBox[0] - gapDeg && p[0] <= fieldBox[2] + gapDeg &&
                    p[1] >= fieldBox[1] - gapDeg && p[1] <= fieldBox[3] + gapDeg) {
                    if (G.pointInRing(p, ring)) continue;
                    // near-field buffer: cheap distance check to bbox edge
                    const ex = Math.max(fieldBox[0] - p[0], 0, p[0] - fieldBox[2]) * cosLat;
                    const ey = Math.max(fieldBox[1] - p[1], 0, p[1] - fieldBox[3]);
                    if (Math.sqrt(ex * ex + ey * ey) * 111320 < NC.innerGapM) continue;
                }
                mask[r * width + col] = 1;
            }
        }
        return mask;
    },
};
