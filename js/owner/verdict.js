/* ============================================
   OWNER REPORT - Verdict (single source of truth)
   Reconciles the field-mean comparison with the
   flagged share and data confidence so the badge
   can never contradict the flags. Both the report
   and the dashboard call deriveVerdict().
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Verdict = {
    // worst -> best severity ordering of the mean-based tiers
    ORDER: ['significant_concern', 'behind', 'slightly_behind', 'normal', 'ahead'],

    _worse(a, b) {
        return this.ORDER.indexOf(a) <= this.ORDER.indexOf(b) ? a : b;
    },

    /**
     * inputs:
     *  meanTier   - tier from Baselines.verdictTier (may be special)
     *  flaggedShare - flagged acres / field acres
     *  validScenes  - count of cloud-passing scenes this window
     *  hasFlags     - boolean
     * Returns { tier, acknowledgesFlags, capped }.
     */
    derive(inputs, cfg) {
        const { meanTier, flaggedShare, validScenes, hasFlags } = inputs;

        // 1. Data-confidence guard dominates everything.
        if (validScenes < cfg.confidence.minScenes) {
            return { tier: 'limited_visibility', acknowledgesFlags: false, capped: false };
        }

        // 2. Special states pass through untouched.
        if (meanTier === 'out_of_season' || meanTier === 'insufficient_data') {
            return { tier: meanTier, acknowledgesFlags: false, capped: false };
        }

        let tier = meanTier;
        let capped = false;
        const v = cfg.verdict;
        const share = flaggedShare || 0;

        // 3. Flagged-share caps the mean-based verdict (never let it look better).
        if (share >= v.concernShare) {
            tier = 'significant_concern';
            capped = true;
        } else if (share >= v.behindShare) {
            tier = this._worse(tier, 'behind');
            capped = true;
        } else if ((tier === 'normal' || tier === 'ahead') && share >= v.normalMaxShare) {
            // Too much flagged to claim "normal" outright -> soften one notch.
            tier = 'slightly_behind';
            capped = true;
        }

        return { tier, acknowledgesFlags: hasFlags, capped };
    },
};
