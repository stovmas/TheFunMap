/* ============================================
   OWNER REPORT - Sub-field anomaly detection
   Per-pixel z-score vs the farm mean per date,
   persistence across consecutive valid dates,
   connected-component clustering.
   Pure functions over aligned raster grids.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Anomaly = {
    /**
     * rasters: [{ date, data: Float32Array }] oldest->newest,
     *          all on the same grid (width x height over bbox).
     * mask:    Uint8Array, 1 = pixel inside buffered farm polygon.
     * Returns { flags: [...], zLatest: Float32Array } where each flag is
     * { acres, compass, dates, spanDays, durationObs, severity, meanZ, pixels }
     */
    detect(rasters, mask, bbox, width, height, ring, cfg) {
        const G = FunMap.Owner.Geometry;
        const n = width * height;

        // Per-date z-scores + farm means for in-farm valid pixels
        const scored = rasters.map(r => this._zScores(r.data, mask, n));
        const zStack = scored.map(s => s.z);
        const meanStack = scored.map(s => s.mean);

        // Longest consecutive run of (z < threshold) per pixel,
        // counting only dates where the pixel itself was valid.
        const bestRun = new Int16Array(n);
        const runNow = new Int16Array(n);
        const runStartIdx = new Int16Array(n).fill(-1);
        const bestStartIdx = new Int16Array(n).fill(-1);
        const bestEndIdx = new Int16Array(n).fill(-1);

        for (let t = 0; t < zStack.length; t++) {
            const z = zStack[t];
            const raw = rasters[t].data;
            const farmMean = meanStack[t];
            for (let i = 0; i < n; i++) {
                if (!mask[i]) continue;
                const v = z[i];
                if (isNaN(v)) continue;          // invalid pixel this date: run pauses
                // Flag needs BOTH a statistical and an agronomic deficit —
                // otherwise uniform healthy fields flag meaningless dips.
                if (v < cfg.zThreshold && (farmMean - raw[i]) >= cfg.minNdviDeficit) {
                    if (runNow[i] === 0) runStartIdx[i] = t;
                    runNow[i]++;
                    if (runNow[i] > bestRun[i]) {
                        bestRun[i] = runNow[i];
                        bestStartIdx[i] = runStartIdx[i];
                        bestEndIdx[i] = t;
                    }
                } else {
                    runNow[i] = 0;
                }
            }
        }

        // Pixels that persisted long enough
        const persistent = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            if (bestRun[i] >= cfg.minConsecutiveDates) persistent[i] = 1;
        }

        // Connected components (4-connectivity)
        const clusters = this._components(persistent, width, height)
            .filter(c => c.length >= cfg.minClusterPixels);

        const pixelAcres = G.pixelAreaM2(bbox, width, height) * 0.000247105;
        const zLatest = zStack.length ? zStack[zStack.length - 1] : new Float32Array(n).fill(NaN);

        const flags = clusters.map((pixels, idx) => {
            // Mean |z| across the cluster over its flagged dates (use latest stack)
            let zSum = 0, zCount = 0;
            let startT = zStack.length - 1, endT = 0;
            pixels.forEach(i => {
                if (bestStartIdx[i] >= 0) startT = Math.min(startT, bestStartIdx[i]);
                if (bestEndIdx[i] >= 0) endT = Math.max(endT, bestEndIdx[i]);
                for (let t = 0; t < zStack.length; t++) {
                    const v = zStack[t][i];
                    if (!isNaN(v) && v < cfg.zThreshold) { zSum += Math.abs(v); zCount++; }
                }
            });
            const meanZ = zCount ? zSum / zCount : 0;

            // Cluster centroid -> compass phrase
            let cSum = 0, rSum = 0;
            pixels.forEach(i => { cSum += i % width; rSum += Math.floor(i / width); });
            const center = G.pixelCenterLngLat(
                cSum / pixels.length, rSum / pixels.length, bbox, width, height);

            const dates = rasters.slice(startT, endT + 1).map(r => r.date);
            const spanDays = dates.length >= 2
                ? Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000)
                : 0;

            return {
                id: 'flag' + (idx + 1),
                acres: Math.round(pixels.length * pixelAcres * 10) / 10,
                compass: G.compassPosition(center, ring),
                centerLngLat: center,
                dates: dates,
                spanDays: spanDays,
                durationObs: Math.min(...pixels.map(i => bestRun[i])),
                meanZ: Math.round(meanZ * 100) / 100,
                severity: meanZ >= cfg.severitySevereZ ? 'severe'
                    : meanZ >= cfg.severityModerateZ ? 'moderate' : 'minor',
                pixels: pixels,
            };
        });

        flags.sort((a, b) => b.acres - a.acres);
        return { flags, zLatest };
    },

    /** z-scores + farm mean over valid in-mask pixels for one date */
    _zScores(data, mask, n) {
        let sum = 0, count = 0;
        for (let i = 0; i < n; i++) {
            if (mask[i] && !isNaN(data[i])) { sum += data[i]; count++; }
        }
        const z = new Float32Array(n).fill(NaN);
        if (count < 10) return { z, mean: NaN };
        const mean = sum / count;
        let varSum = 0;
        for (let i = 0; i < n; i++) {
            if (mask[i] && !isNaN(data[i])) {
                const d = data[i] - mean;
                varSum += d * d;
            }
        }
        const std = Math.sqrt(varSum / count);
        if (std < 1e-6) return { z, mean };
        for (let i = 0; i < n; i++) {
            if (mask[i] && !isNaN(data[i])) z[i] = (data[i] - mean) / std;
        }
        return { z, mean };
    },

    /** 4-connected components over a binary grid; returns arrays of indices */
    _components(bin, width, height) {
        const n = width * height;
        const seen = new Uint8Array(n);
        const out = [];
        for (let start = 0; start < n; start++) {
            if (!bin[start] || seen[start]) continue;
            const queue = [start];
            seen[start] = 1;
            const comp = [];
            while (queue.length) {
                const i = queue.pop();
                comp.push(i);
                const c = i % width, r = (i - c) / width;
                const nbrs = [];
                if (c > 0) nbrs.push(i - 1);
                if (c < width - 1) nbrs.push(i + 1);
                if (r > 0) nbrs.push(i - width);
                if (r < height - 1) nbrs.push(i + width);
                nbrs.forEach(j => {
                    if (bin[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
                });
            }
            out.push(comp);
        }
        return out;
    },
};
