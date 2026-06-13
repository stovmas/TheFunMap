/* ============================================
   OWNER REPORT - Narrative phrase library
   ALL owner-facing wording lives in this file.
   Never use index names (no "NDVI") here —
   say vegetation / crop development / moisture.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.NarrativeTemplates = {
    // Base verdict by tier. {context} = self/neighbor clause (may be empty).
    verdict: {
        ahead: 'Crop is established and tracking ahead of expectations{context}.',
        normal: 'Crop is established and tracking normally{context}.',
        slightly_behind: 'Crop development is slightly behind where this field usually is{context}.',
        behind: 'Crop development is behind normal for this field{context}.',
        significant_concern: 'Vegetation is well below this field’s usual condition and warrants attention{context}.',
        out_of_season: 'The field is between growing seasons; vegetation is at its usual off-season level, so no crop-condition verdict applies this month.',
        insufficient_data: 'Not enough clear satellite passes were available this month for a reliable condition verdict; we’ll catch up on the next clear pass.',
        limited_visibility: 'Persistent cloud cover limited the satellite analysis this month, so no condition verdict is asserted; trends resume in the next report.',
    },

    // When flags exist under an otherwise-fine verdict, soften & acknowledge.
    verdictOverall: {
        ahead: 'Overall the crop is tracking ahead of expectations{context}, though {flagNod} stands out and is detailed below.',
        normal: 'Overall the crop is established and tracking normally{context}, though {flagNod} stands out and is detailed below.',
    },
    flagNod: { one: 'one area', few: 'a couple of areas', many: 'several areas' },

    // Self/neighbor context clauses (filled when data exists).
    selfLead: ' — vegetation is {dir} this farm’s own {window} average',
    selfLeadDir: { ahead: 'ahead of', inline: 'in line with', behind: 'behind' },

    // Neighbor-aware context (gate 5). Chosen by self direction + vs-neighbor.
    neighborContext: {
        behindRegional: ' — but in line with surrounding farms this season, consistent with regional conditions rather than anything specific to this field',
        behindFarmSpecific: ' — while nearby farms are tracking closer to normal, which is worth discussing with the tenant',
        aheadOfNeighbors: ' and ahead of surrounding farms this season',
        onParNeighbors: ', in step with surrounding farms',
    },

    // Flag sentence + evidence-gated cause (gate 4).
    flag: 'A ~{acres}-acre area in the {compass} has lagged the rest of the field across {obs} consecutive satellite passes ({span}), {cause}{action}',
    flagCause: {
        moisture_stress: 'consistent with moisture stress during the recent dry stretch',
        possible_ponding: 'consistent with standing water after recent heavy rain',
        emergence_gap: 'consistent with a slow-emerging patch early in the season',
        unclear: 'though the cause isn’t clear from satellite alone',
    },
    flagAction: {
        moisture_stress: ' — worth asking the tenant about.',
        possible_ponding: ' — worth asking the tenant about.',
        emergence_gap: ' — worth watching as the crop fills in.',
        unclear: ' — worth a ground check.',
    },
    flagSummary: 'Plus {count} smaller area{s} totaling ~{acres} acres, concentrated in the {region} — see the overlay.',
    noFlags: 'No localized problem areas stand out within the field this month.',

    // Weather line.
    weather: 'Rainfall this month: {actual}"{partial}, about {dep}" {dir} normal.',
    weatherNearNormal: 'Rainfall this month: {actual}"{partial}, close to normal.',
    weatherPartialNote: ' so far',

    // Calendar-window names: monthIndex (1-12) -> "mid-June"
    windowName: [
        '', 'mid-January', 'mid-February', 'mid-March', 'mid-April',
        'mid-May', 'mid-June', 'mid-July', 'mid-August',
        'mid-September', 'mid-October', 'mid-November', 'mid-December',
    ],

    tierLabels: {
        ahead: 'Tracking Ahead',
        normal: 'Tracking Normally',
        slightly_behind: 'Slightly Behind',
        behind: 'Behind',
        significant_concern: 'Significant Concern',
        out_of_season: 'Between Seasons',
        insufficient_data: 'Awaiting Clear Imagery',
        limited_visibility: 'Limited Satellite Visibility',
    },
    tierColors: {
        ahead: '#2e7d32', normal: '#2e7d32', slightly_behind: '#b58900',
        behind: '#d2691e', significant_concern: '#c62828',
        out_of_season: '#607d8b', insufficient_data: '#607d8b', limited_visibility: '#607d8b',
    },
};
