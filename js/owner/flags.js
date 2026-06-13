/* ============================================
   OWNER REPORT - Flag aggregation & reporting
   Turns the anomaly persistence layer into a
   small, ranked, floored, merged set of flags.
   Duration phrasing is derived from the actual
   acquisition dates of the passes counted.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Flags = {
    /**
     * layer: output of Anomaly.detect.
     * Returns { flags, overlayFlags, summary, flaggedAcres, flaggedShare }.
     *  - overlayFlags: every cluster above the floor (drawn on the overlay)
     *  - flags: top N by rank, for prose (no pixel arrays)
     *  - summary: one line covering the remainder, or ''
     */
    build(layer, ring, fieldAcres, cfg) {
        const G = FunMap.Owner.Geometry;
        const { width, height, bbox, persistent, dates } = layer;
        const pixelAcres = G.pixelAreaM2(bbox, width, height) * 0.000247105;

        // 1. Merge: dilate persistence, label, then keep ORIGINAL pixels per group
        const dil = this._dilate(persistent, width, height, Math.ceil(cfg.mergeGapPx / 2));
        const labels = this._label(dil, width, height);
        const groups = new Map();
        for (let i = 0; i < persistent.length; i++) {
            if (!persistent[i]) continue;
            const g = labels[i];
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(i);
        }

        // 2. Per-cluster stats
        const floorAcres = Math.max(cfg.minAcresFloor, cfg.minShareFloor * fieldAcres);
        let clusters = [];
        groups.forEach(pixels => {
            const acres = pixels.length * pixelAcres;
            let zSum = 0, fIdx = Infinity, lIdx = -1, persist = 0;
            let cSum = 0, rSum = 0;
            pixels.forEach(i => {
                zSum += layer.pixelAbsZ[i];
                if (layer.firstIdx[i] >= 0) fIdx = Math.min(fIdx, layer.firstIdx[i]);
                if (layer.lastIdx[i] >= 0) lIdx = Math.max(lIdx, layer.lastIdx[i]);
                persist = Math.max(persist, layer.bestRun[i]);
                cSum += i % width; rSum += Math.floor(i / width);
            });
            if (lIdx < 0) return;
            const meanAbsZ = zSum / pixels.length;
            const passCount = lIdx - fIdx + 1;
            const center = G.pixelCenterLngLat(cSum / pixels.length, rSum / pixels.length, bbox, width, height);
            clusters.push({
                pixels,
                acres: Math.round(acres * 10) / 10,
                rawAcres: acres,
                meanZ: Math.round(meanAbsZ * 100) / 100,
                passCount: passCount,
                persistence: persist,
                firstDate: dates[fIdx],
                lastDate: dates[lIdx],
                centerLngLat: center,
                compass: G.compassPosition(center, ring),
                severity: meanAbsZ >= cfg.severitySevereZ ? 'severe'
                    : meanAbsZ >= cfg.severityModerateZ ? 'moderate' : 'minor',
            });
        });

        // 3. Floor
        clusters = clusters.filter(c => c.rawAcres >= floorAcres);

        // 4. Rank by area x depth x persistence
        clusters.forEach(c => { c.rank = c.rawAcres * c.meanZ * c.passCount; });
        clusters.sort((a, b) => b.rank - a.rank);

        const flaggedAcres = Math.round(clusters.reduce((s, c) => s + c.rawAcres, 0) * 10) / 10;
        const overlayFlags = clusters.map((c, i) => ({ ...c, id: 'flag' + (i + 1) }));

        // 5. Cap prose at N; summarize the remainder in one line
        const top = overlayFlags.slice(0, cfg.maxReported);
        const rest = overlayFlags.slice(cfg.maxReported);
        let summary = '';
        if (rest.length > 0) {
            const restAcres = Math.round(rest.reduce((s, c) => s + c.rawAcres, 0) * 10) / 10;
            const region = this._dominantRegion(rest, ring);
            summary = { count: rest.length, acres: restAcres, region: region };
        }

        // Strip pixels from the prose flags (overlay already rendered separately)
        // Rank components persisted so re-ranking is a config change, not a recompute.
        const flags = top.map(c => ({
            id: c.id, acres: c.acres, compass: c.compass, severity: c.severity,
            meanZ: c.meanZ, passCount: c.passCount, persistence: c.persistence,
            firstDate: c.firstDate, lastDate: c.lastDate, causeKey: null,
            rank: Math.round(c.rank * 100) / 100,
            rankComponents: { acres: Math.round(c.rawAcres * 100) / 100, depth: c.meanZ, passes: c.passCount },
        }));

        return {
            flags, overlayFlags, summary,
            flaggedAcres, flaggedShare: fieldAcres > 0 ? flaggedAcres / fieldAcres : 0,
        };
    },

    /** "about a week and a half" from two ISO dates (gate 3) */
    durationPhrase(firstDate, lastDate) {
        const days = Math.round((new Date(lastDate) - new Date(firstDate)) / 86400000);
        if (days < 5) return 'a few days';
        const weeks = days / 7;
        const whole = Math.floor(weeks);
        const frac = weeks - whole;
        let val;                                   // round to nearest sensible half
        if (frac >= 0.35 && frac <= 0.65) val = whole + 0.5;
        else val = Math.round(weeks);
        if (val <= 1) return 'about a week';
        if (val === 1.5) return 'about a week and a half';
        const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
            'eight', 'nine', 'ten', 'eleven', 'twelve'];
        const w = words[Math.floor(val)] || Math.floor(val);
        return Number.isInteger(val) ? `about ${w} weeks` : `about ${w} and a half weeks`;
    },

    _dominantRegion(flags, ring) {
        let lng = 0, lat = 0;
        flags.forEach(f => { lng += f.centerLngLat[0]; lat += f.centerLngLat[1]; });
        return FunMap.Owner.Geometry.compassPosition([lng / flags.length, lat / flags.length], ring);
    },

    /** Chebyshev dilation by r pixels */
    _dilate(bin, w, h, r) {
        if (r <= 0) return bin;
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!bin[y * w + x]) continue;
                for (let dy = -r; dy <= r; dy++) {
                    const ny = y + dy; if (ny < 0 || ny >= h) continue;
                    for (let dx = -r; dx <= r; dx++) {
                        const nx = x + dx; if (nx < 0 || nx >= w) continue;
                        out[ny * w + nx] = 1;
                    }
                }
            }
        }
        return out;
    },

    /** 8-connected labeling; returns Int32Array of labels (0 = none) */
    _label(bin, w, h) {
        const labels = new Int32Array(w * h);
        let next = 0;
        for (let s = 0; s < w * h; s++) {
            if (!bin[s] || labels[s]) continue;
            next++;
            const stack = [s];
            labels[s] = next;
            while (stack.length) {
                const i = stack.pop();
                const x = i % w, y = (i - x) / w;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        const j = ny * w + nx;
                        if (bin[j] && !labels[j]) { labels[j] = next; stack.push(j); }
                    }
                }
            }
        }
        return labels;
    },
};
