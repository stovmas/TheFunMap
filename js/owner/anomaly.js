/* ============================================
   OWNER REPORT - Sub-field anomaly detection
   Per-pixel z-score vs the farm mean per date +
   persistence across consecutive valid passes.
   Produces per-pixel primitives only; spatial
   clustering / floor / merge live in flags.js.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Anomaly = {
    /**
     * rasters: [{ date, data: Float32Array }] oldest->newest, same grid.
     * mask:    Uint8Array, 1 = pixel inside analysis polygon.
     * Returns per-pixel persistence layer:
     * { dates, width, height, bbox, persistent, bestRun,
     *   firstIdx, lastIdx, pixelAbsZ, zLatest }
     */
    detect(rasters, mask, bbox, width, height, cfg) {
        const n = width * height;
        const dates = rasters.map(r => r.date);

        const scored = rasters.map(r => this._zScores(r.data, mask, n));
        const zStack = scored.map(s => s.z);
        const meanStack = scored.map(s => s.mean);

        const bestRun = new Int16Array(n);
        const runNow = new Int16Array(n);
        const runStartIdx = new Int16Array(n).fill(-1);
        const firstIdx = new Int16Array(n).fill(-1);
        const lastIdx = new Int16Array(n).fill(-1);
        const absZSum = new Float64Array(n);
        const absZCnt = new Int32Array(n);

        for (let t = 0; t < zStack.length; t++) {
            const z = zStack[t];
            const raw = rasters[t].data;
            const farmMean = meanStack[t];
            for (let i = 0; i < n; i++) {
                if (!mask[i]) continue;
                const v = z[i];
                if (isNaN(v)) continue;          // pixel invalid this date: run pauses
                // Flag needs BOTH a statistical and an agronomic deficit so
                // uniform healthy fields don't flag meaningless dips.
                if (v < cfg.zThreshold && (farmMean - raw[i]) >= cfg.minNdviDeficit) {
                    if (runNow[i] === 0) runStartIdx[i] = t;
                    runNow[i]++;
                    absZSum[i] += Math.abs(v);
                    absZCnt[i]++;
                    if (runNow[i] > bestRun[i]) {
                        bestRun[i] = runNow[i];
                        firstIdx[i] = runStartIdx[i];
                        lastIdx[i] = t;
                    }
                } else {
                    runNow[i] = 0;
                }
            }
        }

        const persistent = new Uint8Array(n);
        const pixelAbsZ = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            if (bestRun[i] >= cfg.minConsecutiveDates) persistent[i] = 1;
            pixelAbsZ[i] = absZCnt[i] ? absZSum[i] / absZCnt[i] : 0;
        }

        return {
            dates, width, height, bbox,
            persistent, bestRun, firstIdx, lastIdx, pixelAbsZ,
            zLatest: zStack.length ? zStack[zStack.length - 1] : new Float32Array(n).fill(NaN),
        };
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
};
