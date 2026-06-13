/* ============================================
   OWNER REPORT - Narrative builder (pure)
   FarmAssessment -> owner-facing sentences.
   All wording comes from NarrativeTemplates.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Narrative = {
    _fill(tpl, vars) {
        return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    },

    monthName(monthStr) {
        const [y, m] = monthStr.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US',
            { month: 'long', year: 'numeric', timeZone: 'UTC' });
    },

    headerLine(farm, assessment) {
        const county = farm.county ? `, ${farm.county} County` : '';
        return `${farm.name} — ${farm.acreage} acres${county} — ${this.monthName(assessment.month)}`;
    },

    /** Context clause: self direction, refined by neighbor when present. */
    _contextClause(v, windowName) {
        const T = FunMap.Owner.NarrativeTemplates;
        if (v.pctVsSelf === null || v.pctVsSelf === undefined) return '';
        const dir = v.pctVsSelf >= 103 ? 'ahead' : v.pctVsSelf >= 97 ? 'inline' : 'behind';
        let clause = this._fill(T.selfLead, { dir: T.selfLeadDir[dir], window: windowName });

        if (v.pctVsNeighbor !== null && v.pctVsNeighbor !== undefined) {
            if (dir === 'behind') {
                clause += v.pctVsNeighbor >= 95
                    ? T.neighborContext.behindRegional       // field ≈ neighbors (both low)
                    : T.neighborContext.behindFarmSpecific;  // neighbors doing better
            } else if (dir === 'ahead' && v.pctVsNeighbor >= 108) {
                clause += T.neighborContext.aheadOfNeighbors;
            } else if (Math.abs(v.pctVsNeighbor - 100) <= 5) {
                clause += T.neighborContext.onParNeighbors;
            }
        }
        return clause;
    },

    verdictText(assessment) {
        const T = FunMap.Owner.NarrativeTemplates;
        const v = assessment.verdict;
        const tier = v.tier;
        if (['out_of_season', 'insufficient_data', 'limited_visibility'].includes(tier)) {
            return T.verdict[tier];
        }
        const m = parseInt(assessment.month.split('-')[1], 10);
        const context = this._contextClause(v, T.windowName[m]);

        // Acknowledge flags under an otherwise-fine verdict.
        if (v.acknowledgesFlags && T.verdictOverall[tier]) {
            const fc = v.flagCount || 1;
            const flagNod = fc === 1 ? T.flagNod.one : fc === 2 ? T.flagNod.few : T.flagNod.many;
            return this._fill(T.verdictOverall[tier], { context, flagNod });
        }
        return this._fill(T.verdict[tier], { context });
    },

    flagTexts(assessment) {
        const T = FunMap.Owner.NarrativeTemplates;
        return assessment.flags.map(f => this._fill(T.flag, {
            acres: f.acres,
            compass: f.compass,
            obs: f.passCount,
            span: FunMap.Owner.Flags.durationPhrase(f.firstDate, f.lastDate),
            cause: T.flagCause[f.causeKey] || T.flagCause.unclear,
            action: T.flagAction[f.causeKey] || T.flagAction.unclear,
        }));
    },

    flagSummaryText(assessment) {
        const T = FunMap.Owner.NarrativeTemplates;
        const s = assessment.flagSummary;
        if (!s || !s.count) return '';
        return this._fill(T.flagSummary, {
            count: s.count, s: s.count === 1 ? '' : 's', acres: s.acres, region: s.region,
        });
    },

    weatherText(assessment) {
        const T = FunMap.Owner.NarrativeTemplates;
        const w = assessment.weather;
        if (!w) return '';
        const partial = w.partialMonth ? T.weatherPartialNote : '';
        const dep = Math.abs(w.departureIn);
        if (dep < 0.3) return this._fill(T.weatherNearNormal, { actual: w.monthPrecipIn, partial });
        return this._fill(T.weather, {
            actual: w.monthPrecipIn, partial: partial,
            dep: dep.toFixed(1).replace(/\.0$/, ''), dir: w.departureIn > 0 ? 'above' : 'below',
        });
    },

    /** Full owner paragraph: verdict + flags + remainder summary (or all-clear) */
    bodyText(assessment) {
        const parts = [this.verdictText(assessment)];
        if (assessment.verdict.tier === 'limited_visibility') return parts.join(' ');

        const flags = this.flagTexts(assessment);
        if (flags.length > 0) {
            const lead = flags.length === 1 ? 'One flag: ' : `${flags.length} flags: `;
            parts.push(lead + flags.join(' '));
            const summary = this.flagSummaryText(assessment);
            if (summary) parts.push(summary);
        } else if (!assessment.verdict.acknowledgesFlags) {
            parts.push(FunMap.Owner.NarrativeTemplates.noFlags);
        }
        return parts.join(' ');
    },

    tierLabel(tier) { return FunMap.Owner.NarrativeTemplates.tierLabels[tier] || tier; },
    tierColor(tier) { return FunMap.Owner.NarrativeTemplates.tierColors[tier] || '#607d8b'; },
};
