/* ============================================
   OWNER REPORT - Narrative phrase library
   ALL owner-facing wording lives in this file.
   Never use index names (no "NDVI") here —
   say vegetation / crop development / moisture.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.NarrativeTemplates = {
    // Verdict opener by tier. {pctNeighbor} and {selfPhrase} are optional
    // fragments the builder fills when the data exists.
    verdict: {
        ahead: 'Crop is established and tracking ahead of expectations{neighborClause}{selfClause}.',
        normal: 'Crop is established and tracking normally{neighborClause}{selfClause}.',
        slightly_behind: 'Crop development is slightly behind where this field usually is{neighborClause}{selfClause}.',
        behind: 'Crop development is behind normal for this field{neighborClause}{selfClause}.',
        significant_concern: 'Vegetation is well below this field’s usual condition and warrants attention{neighborClause}{selfClause}.',
        out_of_season: 'The field is between growing seasons; vegetation is at its usual off-season level and no crop condition verdict applies this month.',
        insufficient_data: 'Not enough clear satellite passes were available this month for a reliable condition verdict; we’ll catch up on the next clear pass.',
    },

    // " — vegetation is at 94% of comparable nearby fields"
    neighborClause: ' — vegetation is at {pct}% of comparable nearby fields',

    // self-comparison fragment, chosen by pctVsSelf
    selfClause: {
        wellAhead: ' and well ahead of this farm’s own {window} average',     // >= 110
        ahead: ' and slightly ahead of this farm’s own {window} average',     // 103–110
        inline: ' and in line with this farm’s own {window} average',         // 97–103
        slightlyBehind: ' and slightly behind this farm’s own {window} average', // 90–97
        behind: ' and behind this farm’s own {window} average',               // < 90
    },
    // When there's no neighbor benchmark, the self comparison leads instead:
    selfLead: ' — vegetation is {dir} this farm’s own {window} average',
    selfLeadDir: { ahead: 'ahead of', inline: 'in line with', behind: 'behind' },

    // Flag sentence. One per flag.
    flag: 'A ~{acres}-acre area in the {compass} has lagged the rest of the field across {obs} consecutive satellite passes (about {span}), {cause}{action}',
    flagCause: {
        ponding: 'consistent with ponding after the recent heavy rain',
        moisture_stress: 'consistent with moisture stress during the recent dry stretch',
        generic: 'a pattern consistent with drainage, compaction, or localized stress',
    },
    flagAction: {
        minor: '.',
        moderate: ' — worth asking the tenant about on the next visit.',
        severe: ' — recommend the tenant walk this area soon.',
    },
    noFlags: 'No localized problem areas stand out within the field this month.',

    // Weather line for the footer.
    weather: 'Rainfall this month: {actual}"{partial}, about {dep}" {dir} normal.',
    weatherNearNormal: 'Rainfall this month: {actual}"{partial}, close to normal.',
    weatherPartialNote: ' so far',

    // Span phrasing helpers
    spanWeeks: { one: 'a week', some: '{n} weeks' },
    spanDays: '{n} days',

    // Calendar-window names: monthIndex (1-12) -> phrase like "mid-June"
    windowName: [
        '', 'mid-January', 'mid-February', 'mid-March', 'mid-April',
        'mid-May', 'mid-June', 'mid-July', 'mid-August',
        'mid-September', 'mid-October', 'mid-November', 'mid-December',
    ],

    // Verdict tier display labels (dashboard / PDF badge)
    tierLabels: {
        ahead: 'Tracking Ahead',
        normal: 'Tracking Normally',
        slightly_behind: 'Slightly Behind',
        behind: 'Behind',
        significant_concern: 'Significant Concern',
        out_of_season: 'Between Seasons',
        insufficient_data: 'Awaiting Clear Imagery',
    },
    tierColors: {
        ahead: '#2e7d32', normal: '#2e7d32', slightly_behind: '#b58900',
        behind: '#d2691e', significant_concern: '#c62828',
        out_of_season: '#607d8b', insufficient_data: '#607d8b',
    },
};
