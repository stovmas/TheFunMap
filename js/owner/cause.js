/* ============================================
   OWNER REPORT - Evidence-gated cause table
   Satellite sees PATTERN, not CAUSE. Cause
   language is only emitted when weather (or
   season) evidence supports it; otherwise the
   flag says the cause is unclear.
   Vocabulary: moisture_stress | possible_ponding
               | emergence_gap | unclear
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Cause = {
    /**
     * Decide a cause key from evidence.
     * weather: { departureIn } or null. monthIdx: 1-12.
     * fieldMean: current field NDVI mean (for early-season gate).
     * Returns one of the vocabulary keys.
     */
    assign(weather, monthIdx, fieldMean, cfg) {
        const dep = weather ? weather.departureIn : null;

        if (dep !== null && dep <= cfg.dryDepartureIn) return 'moisture_stress';
        if (dep !== null && dep >= cfg.wetDepartureIn) return 'possible_ponding';

        // Emergence gap only early in the season AND when overall vegetation
        // is still low (so we're not calling a mid-season dip "emergence").
        if (cfg.earlySeasonMonths.includes(monthIdx) &&
            fieldMean !== null && fieldMean < cfg.earlySeasonMaxMean) {
            return 'emergence_gap';
        }
        return 'unclear';
    },
};
