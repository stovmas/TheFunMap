/* ============================================
   OWNER REPORT - Baseline math (pure functions)
   Self baseline: this farm's NDVI in the same
   calendar window across prior years.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Baselines = {
    /** Day-of-year (1..366) for "YYYY-MM-DD" */
    dayOfYear(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
    },

    /**
     * Valid rows only (validity rule applied here, once).
     */
    validRows(timeseries, minValidFraction) {
        return timeseries.filter(r =>
            r.validFraction >= minValidFraction &&
            r.ndviMean !== null && r.ndviMean !== undefined && isFinite(r.ndviMean));
    },

    /**
     * Self baseline for a calendar window.
     * windowCenter: "YYYY-MM-DD" (typically mid report month)
     * halfWidthDays: window is center ± halfWidth in day-of-year terms
     * Excludes the report year itself.
     * Returns { mean, std, years: [..], n } or null if insufficient history.
     */
    selfBaseline(validRows, windowCenter, halfWidthDays, excludeYear) {
        const centerDoy = this.dayOfYear(windowCenter);
        const inWindow = validRows.filter(r => {
            const year = parseInt(r.date.split('-')[0], 10);
            if (year === excludeYear) return false;
            let delta = Math.abs(this.dayOfYear(r.date) - centerDoy);
            if (delta > 183) delta = 366 - delta;   // wrap year boundary
            return delta <= halfWidthDays;
        });
        if (inWindow.length < 3) return null;

        // Average per year first so a cloudy year doesn't dominate
        const byYear = {};
        inWindow.forEach(r => {
            const y = r.date.split('-')[0];
            (byYear[y] = byYear[y] || []).push(r.ndviMean);
        });
        const yearMeans = Object.keys(byYear).map(y =>
            byYear[y].reduce((s, v) => s + v, 0) / byYear[y].length);
        if (yearMeans.length < 2) return null;

        const mean = yearMeans.reduce((s, v) => s + v, 0) / yearMeans.length;
        const variance = yearMeans.reduce((s, v) => s + (v - mean) * (v - mean), 0) /
            Math.max(1, yearMeans.length - 1);
        return {
            mean: mean,
            std: Math.sqrt(variance),
            years: Object.keys(byYear).sort(),
            n: inWindow.length,
        };
    },

    /**
     * Current-condition value: mean NDVI of the most recent
     * `take` valid rows inside the report window.
     */
    currentValue(validRows, fromDate, toDate, take = 3) {
        const inWindow = validRows.filter(r => r.date >= fromDate && r.date <= toDate);
        const recent = inWindow.slice(-take);
        if (recent.length === 0) return null;
        return {
            mean: recent.reduce((s, r) => s + r.ndviMean, 0) / recent.length,
            dates: recent.map(r => r.date),
            latestDate: recent[recent.length - 1].date,
            latestValidFraction: recent[recent.length - 1].validFraction,
        };
    },

    /**
     * Neighbor benchmark: mean of comparison-polygon NDVI means
     * over the same window. rowsPerComp: array of timeseries arrays.
     */
    neighborBenchmark(rowsPerComp, fromDate, toDate, minValidFraction) {
        const compMeans = [];
        rowsPerComp.forEach(rows => {
            const valid = this.validRows(rows, minValidFraction)
                .filter(r => r.date >= fromDate && r.date <= toDate);
            if (valid.length === 0) return;
            const recent = valid.slice(-3);
            compMeans.push(recent.reduce((s, r) => s + r.ndviMean, 0) / recent.length);
        });
        if (compMeans.length === 0) return null;
        return {
            mean: compMeans.reduce((s, v) => s + v, 0) / compMeans.length,
            nComps: compMeans.length,
        };
    },

    /** Audit table of every scene in the window: used / excluded + reason */
    sceneTable(allRows, fromDate, toDate, minValidFraction) {
        return allRows
            .filter(r => r.date >= fromDate && r.date <= toDate)
            .map(r => ({
                date: r.date,
                validPct: Math.round((r.validFraction || 0) * 100),
                used: r.validFraction >= minValidFraction,
                reason: r.validFraction >= minValidFraction ? ''
                    : `clouds (<${Math.round(minValidFraction * 100)}% valid)`,
            }));
    },

    /** Verdict tier from ratios; null baseline pieces degrade gracefully */
    verdictTier(currentMean, selfBase, cfg) {
        if (selfBase && selfBase.mean < cfg.outOfSeasonNdvi) return 'out_of_season';
        if (!selfBase || currentMean === null) return 'insufficient_data';
        const ratio = currentMean / selfBase.mean;
        if (ratio >= cfg.aheadRatio) return 'ahead';
        if (ratio >= cfg.normalRatio) return 'normal';
        if (ratio >= cfg.slightlyBehindRatio) return 'slightly_behind';
        if (ratio >= cfg.behindRatio) return 'behind';
        return 'significant_concern';
    },
};
