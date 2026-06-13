/* ============================================
   OWNER REPORT - Portfolios
   Named groups of farms belonging to a firm.
   v1 auto-creates one 'main' portfolio; the
   schema supports many.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Portfolio = {
    DEFAULT_ID: 'main',

    async ensureDefault() {
        const DB = FunMap.Owner.DB;
        let p = await DB.get('portfolios', this.DEFAULT_ID);
        if (!p) {
            p = {
                id: this.DEFAULT_ID,
                firmId: FunMap.Owner.Model.DEFAULT_FIRM_ID,
                name: 'Main Portfolio',
                scheduleEnabled: false,
                scheduleDay: 1,            // run on/after this day of month
                lastScheduledMonth: null,  // "YYYY-MM" of last auto run
                createdAt: new Date().toISOString(),
            };
            await DB.put('portfolios', p);
        }
        return p;
    },

    async getAll() {
        const all = await FunMap.Owner.DB.getAll('portfolios');
        return all.sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(id) {
        return FunMap.Owner.DB.get('portfolios', id);
    },

    async save(portfolio) {
        await FunMap.Owner.DB.put('portfolios', portfolio);
        return portfolio;
    },

    async create(name) {
        const p = {
            id: FunMap.Utils.uid(),
            firmId: FunMap.Owner.Model.DEFAULT_FIRM_ID,
            name: name,
            scheduleEnabled: false,
            scheduleDay: 1,
            lastScheduledMonth: null,
            createdAt: new Date().toISOString(),
        };
        await FunMap.Owner.DB.put('portfolios', p);
        return p;
    },

    /** Farms in a portfolio (unassigned farms count as 'main') */
    async farmsIn(portfolioId) {
        const farms = await FunMap.Owner.Model.getFarms();
        return farms.filter(f =>
            (f.portfolioId || this.DEFAULT_ID) === portfolioId);
    },

    /** Latest assessment per farm id, for ranking */
    async latestAssessments(farms) {
        const out = {};
        for (const f of farms) {
            out[f.id] = f.lastAssessmentId
                ? await FunMap.Owner.DB.get('assessments', f.lastAssessmentId)
                : null;
        }
        return out;
    },

    /** All assessments for one farm, newest first (report archive) */
    async archiveFor(farmId) {
        const rows = await FunMap.Owner.DB.getAllByIndex('assessments', 'farmId', farmId);
        return rows.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    },
};
