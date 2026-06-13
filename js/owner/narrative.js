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

    /** Header line: "Henderson Farm — 212 acres, Macon County — June 2026" */
    headerLine(farm, assessment) {
        const county = farm.county ? `, ${farm.county} County` : '';
        return `${farm.name} — ${farm.acreage} acres${county} — ${this.monthName(assessment.month)}`;
    },

    /** The verdict paragraph (1–2 sentences) */
    verdictText(assessment) {
        const T = FunMap.Owner.NarrativeTemplates;
        const v = assessment.verdict;
        const tier = v.tier;
        if (tier === 'out_of_season' || tier === 'insufficient_data') {
            return T.verdict[tier];
        }

        const m = parseInt(assessment.month.split('-')[1], 10);
        const windowName = T.windowName[m];

        let neighborClause = '', selfClause = '';
        if (v.pctVsNeighbor !== null) {
            neighborClause = this._fill(T.neighborClause, { pct: v.pctVsNeighbor });
            if (v.pctVsSelf !== null) {
                selfClause = this._fill(this._selfClauseTpl(v.pctVsSelf), { window: windowName });
            }
        } else if (v.pctVsSelf !== null) {
            const dir = v.pctVsSelf >= 103 ? T.selfLeadDir.ahead
                : v.pctVsSelf >= 97 ? T.selfLeadDir.inline : T.selfLeadDir.behind;
            neighborClause = this._fill(T.selfLead, { dir: dir, window: windowName });
        }

        return this._fill(T.verdict[tier], { neighborClause, selfClause });
    },

    _selfClauseTpl(pct) {
        const T = FunMap.Owner.NarrativeTemplates;
        if (pct >= 110) return T.selfClause.wellAhead;
        if (pct >= 103) return T.selfClause.ahead;
        if (pct >= 97) return T.selfClause.inline;
        if (pct >= 90) return T.selfClause.slightlyBehind;
        return T.selfClause.behind;
    },

    /** One sentence per flag */
    flagTexts(assessment) {
        const T = FunMap.Owner.NarrativeTemplates;
        return assessment.flags.map(f => {
            const span = this._spanPhrase(f.spanDays);
            return this._fill(T.flag, {
                acres: f.acres,
                compass: f.compass,
                obs: f.durationObs,
                span: span,
                cause: T.flagCause[f.causeHint] || T.flagCause.generic,
                action: T.flagAction[f.severity] || T.flagAction.minor,
            });
        });
    },

    _spanPhrase(days) {
        const T = FunMap.Owner.NarrativeTemplates;
        if (days >= 11) {
            const weeks = Math.round(days / 7);
            return weeks <= 1 ? T.spanWeeks.one : this._fill(T.spanWeeks.some, { n: weeks });
        }
        return this._fill(T.spanDays, { n: Math.max(days, 1) });
    },

    weatherText(assessment) {
        const T = FunMap.Owner.NarrativeTemplates;
        const w = assessment.weather;
        if (!w) return '';
        const partial = w.partialMonth ? T.weatherPartialNote : '';
        const dep = Math.abs(w.departureIn);
        if (dep < 0.3) {
            return this._fill(T.weatherNearNormal, { actual: w.monthPrecipIn, partial });
        }
        return this._fill(T.weather, {
            actual: w.monthPrecipIn,
            partial: partial,
            dep: dep.toFixed(1).replace(/\.0$/, ''),
            dir: w.departureIn > 0 ? 'above' : 'below',
        });
    },

    /** Full owner paragraph: verdict + flags (or all-clear) */
    bodyText(assessment) {
        const parts = [this.verdictText(assessment)];
        const flags = this.flagTexts(assessment);
        if (flags.length > 0) {
            const lead = flags.length === 1 ? 'One flag: ' : `${flags.length} flags: `;
            parts.push(lead + flags.join(' '));
        } else if (assessment.verdict.tier !== 'insufficient_data') {
            parts.push(FunMap.Owner.NarrativeTemplates.noFlags);
        }
        return parts.join(' ');
    },

    tierLabel(tier) { return FunMap.Owner.NarrativeTemplates.tierLabels[tier] || tier; },
    tierColor(tier) { return FunMap.Owner.NarrativeTemplates.tierColors[tier] || '#607d8b'; },
};
