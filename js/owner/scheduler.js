/* ============================================
   OWNER REPORT - Scheduling & batch runs
   Monthly auto-run per portfolio (browser-
   resident: checks at boot + hourly while a
   tab is open, same model as Janus monitors).
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Scheduler = {
    _running: false,

    init() {
        setTimeout(() => this.checkDue(), 8000);
        setInterval(() => this.checkDue(), 60 * 60 * 1000);
    },

    _credsOk() {
        return !!FunMap.Settings.getApiKey('cdse_client_id') &&
               !!FunMap.Settings.getApiKey('cdse_client_secret');
    },

    /** Auto-run any portfolio whose monthly schedule is due. */
    async checkDue() {
        if (this._running || !this._credsOk()) return;
        const month = new Date().toISOString().substring(0, 7);
        const day = new Date().getDate();
        const portfolios = await FunMap.Owner.Portfolio.getAll();

        for (const p of portfolios) {
            if (!p.scheduleEnabled) continue;
            if (p.lastScheduledMonth === month) continue;
            if (day < (p.scheduleDay || 1)) continue;

            FunMap.Utils.toast(`Owner Report: monthly run starting for "${p.name}"...`, 'info', 6000);
            const result = await this.runPortfolio(p.id, month);
            p.lastScheduledMonth = month;
            await FunMap.Owner.Portfolio.save(p);
            FunMap.Utils.toast(
                `Owner Report: "${p.name}" done — ${result.ok} report${result.ok !== 1 ? 's' : ''}` +
                (result.failed ? `, ${result.failed} failed` : '') + '.',
                result.failed ? 'warning' : 'success', 8000);
        }
    },

    /**
     * Run assessments for every farm in a portfolio (sequential).
     * Returns { ok, failed, errors: [{farm, message}] }.
     */
    async runPortfolio(portfolioId, monthStr, onStatus) {
        if (this._running) return { ok: 0, failed: 0, errors: [{ farm: '', message: 'A run is already in progress' }] };
        this._running = true;
        const say = onStatus || (() => {});
        const result = { ok: 0, failed: 0, errors: [] };

        try {
            const farms = await FunMap.Owner.Portfolio.farmsIn(portfolioId);
            for (let i = 0; i < farms.length; i++) {
                const farm = farms[i];
                say(`(${i + 1}/${farms.length}) ${farm.name}`);
                FunMap.Utils.setStatus(`OWNER REPORT ${i + 1}/${farms.length}: ${farm.name.toUpperCase()}`);
                try {
                    await FunMap.Owner.Assessment.run(farm, monthStr);
                    result.ok++;
                } catch (err) {
                    console.error(`Assessment failed for ${farm.name}:`, err);
                    result.failed++;
                    result.errors.push({ farm: farm.name, message: err.message });
                }
            }
        } finally {
            this._running = false;
            FunMap.Utils.setStatus('SYSTEMS ONLINE');
        }
        return result;
    },
};
