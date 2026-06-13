/* ============================================
   OWNER REPORT - Triage dashboard
   Farms ranked by severity: active flags first,
   then behind verdicts. Sparkline of the season
   trend, archive per farm, run/export controls.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Dashboard = {
    _portfolioId: 'main',

    init() {
        document.getElementById('owner-dashboard-btn').addEventListener('click', () => this.open());
        document.getElementById('owner-dash-close').addEventListener('click', () => this.close());
        document.getElementById('owner-dash-run').addEventListener('click', () => this._runPortfolio());
        document.getElementById('owner-dash-export').addEventListener('click', () => this._export());
        document.getElementById('owner-dash-schedule').addEventListener('change', () => this._saveSchedule());
        document.getElementById('owner-dash-schedule-day').addEventListener('change', () => this._saveSchedule());
    },

    /** Triage score: flags dominate, then verdict tier (pure, tested) */
    severityScore(assessment) {
        if (!assessment) return -1;
        const sev = { severe: 3, moderate: 2, minor: 1 };
        const tier = { significant_concern: 5, behind: 4, slightly_behind: 3, insufficient_data: 1 };
        const flagScore = (assessment.flags || []).reduce((s, f) => s + (sev[f.severity] || 1), 0);
        return flagScore * 100 + (tier[assessment.verdict.tier] || 0) * 10;
    },

    /** Inline SVG sparkline from assessment.sparkline rows (pure, tested) */
    sparklineSvg(points, w = 120, h = 26) {
        if (!points || points.length < 2) return '<span style="color:#999;font-size:10px;">no data</span>';
        const vs = points.map(p => p.v);
        const min = Math.min(...vs), max = Math.max(...vs);
        const span = (max - min) || 1;
        const coords = points.map((p, i) =>
            `${(i / (points.length - 1) * (w - 4) + 2).toFixed(1)},` +
            `${(h - 3 - (p.v - min) / span * (h - 6)).toFixed(1)}`).join(' ');
        return `<svg width="${w}" height="${h}" style="display:block;">` +
            `<polyline points="${coords}" fill="none" stroke="#2e7d32" stroke-width="1.6"/></svg>`;
    },

    async open() {
        await FunMap.Owner.Portfolio.ensureDefault();
        document.getElementById('owner-dashboard').classList.remove('hidden');
        await this.refresh();
    },

    close() {
        document.getElementById('owner-dashboard').classList.add('hidden');
    },

    async refresh() {
        const p = await FunMap.Owner.Portfolio.get(this._portfolioId);
        document.getElementById('owner-dash-title').textContent = p ? p.name : 'Portfolio';
        document.getElementById('owner-dash-schedule').checked = !!(p && p.scheduleEnabled);
        document.getElementById('owner-dash-schedule-day').value = (p && p.scheduleDay) || 1;

        const farms = await FunMap.Owner.Portfolio.farmsIn(this._portfolioId);
        const latest = await FunMap.Owner.Portfolio.latestAssessments(farms);
        const N = FunMap.Owner.Narrative;
        const esc = FunMap.Utils.escapeHtml;

        farms.sort((a, b) => this.severityScore(latest[b.id]) - this.severityScore(latest[a.id]));

        const body = document.getElementById('owner-dash-body');
        if (farms.length === 0) {
            body.innerHTML = '<div class="empty-state" style="padding:20px;">No farms in this portfolio yet.</div>';
            return;
        }

        body.innerHTML = `<table class="owner-dash-table"><thead><tr>
            <th>FARM</th><th>VERDICT</th><th>FLAGS</th><th>SEASON TREND</th><th>LAST REPORT</th><th></th>
        </tr></thead><tbody>` + farms.map(f => {
            const a = latest[f.id];
            const tier = a ? a.verdict.tier : null;
            const flagsTxt = a && a.flags.length
                ? `${a.flags.length} (${a.flags.reduce((s, x) => s + x.acres, 0).toFixed(1)} ac)` : '—';
            const lc = f.landCover;
            const blocked = lc && lc.blocked && !f.landCoverConfirmed;
            const lcSub = lc ? ` · ${Math.round(lc.croplandShare * 100)}% crop` +
                (f.landCoverConfirmed ? ' (confirmed)' : lc.maskApplied ? ' (masked)' : '') : '';
            const covSub = a && a.observations && a.observations.validScenesInWindow !== undefined
                ? ` · ${a.observations.validScenesInWindow} scenes` : '';
            const verdictCell = blocked
                ? '<span class="owner-dash-badge" style="background:#c62828">BLOCKED — RETRACE BOUNDARY</span>'
                : tier ? `<span class="owner-dash-badge" style="background:${N.tierColor(tier)}">${esc(N.tierLabel(tier))}</span>`
                : '<span class="owner-dash-sub">no report</span>';
            return `<tr data-farm="${f.id}">
                <td><b>${esc(f.name)}</b><br><span class="owner-dash-sub">${f.acreage} ac · ${esc(f.county || '?')}${f.cropType ? ' · ' + esc(f.cropType) : ''}${lcSub}${covSub}</span></td>
                <td>${verdictCell}</td>
                <td style="color:${a && a.flags.length ? '#d2691e' : '#888'};font-weight:${a && a.flags.length ? '700' : '400'}">${flagsTxt}</td>
                <td>${this.sparklineSvg(a ? a.sparkline : null)}</td>
                <td class="owner-dash-sub">${a ? FunMap.Utils.formatDate(a.generatedAt) : '—'}</td>
                <td class="owner-dash-actions">
                    <button class="xbox-btn xs d-view" data-id="${f.id}" ${a ? '' : 'disabled'}>VIEW</button>
                    <button class="xbox-btn xs d-pdf" data-id="${f.id}" ${a ? '' : 'disabled'}>PDF</button>
                    <button class="xbox-btn xs ghost d-arch" data-id="${f.id}">ARCHIVE</button>
                    <button class="xbox-btn xs ghost d-run" data-id="${f.id}">RUN</button>
                </td></tr>
                <tr class="owner-dash-archive hidden" data-archive="${f.id}"><td colspan="6"></td></tr>`;
        }).join('') + '</tbody></table>';

        const wire = (cls, fn) => body.querySelectorAll(cls).forEach(b =>
            b.addEventListener('click', e => { e.stopPropagation(); fn(b.dataset.id); }));
        wire('.d-view', id => { this.close(); FunMap.Owner.UI.openViewer(id); });
        wire('.d-pdf', id => this._downloadPdf(id));
        wire('.d-arch', id => this._toggleArchive(id));
        wire('.d-run', id => this._runFarm(id));
    },

    async _toggleArchive(farmId) {
        const row = document.querySelector(`tr[data-archive="${farmId}"]`);
        if (!row.classList.contains('hidden')) { row.classList.add('hidden'); return; }
        const items = await FunMap.Owner.Portfolio.archiveFor(farmId);
        const cell = row.firstElementChild;
        cell.innerHTML = items.length === 0
            ? '<div class="empty-state">No archived reports.</div>'
            : items.map(a => `<span class="owner-arch-item">${a.month}
                (${a.flags.length} flag${a.flags.length !== 1 ? 's' : ''})
                <button class="xbox-btn xs a-view" data-farm="${farmId}" data-a="${a.id}">VIEW</button></span>`).join('');
        cell.querySelectorAll('.a-view').forEach(b => b.addEventListener('click', () => {
            this.close();
            FunMap.Owner.UI.openViewer(b.dataset.farm, b.dataset.a);
        }));
        row.classList.remove('hidden');
    },

    async _downloadPdf(farmId) {
        const farm = await FunMap.Owner.Model.getFarm(farmId);
        const firm = await FunMap.Owner.Model.ensureDefaultFirm();
        const a = farm.lastAssessmentId && await FunMap.Owner.DB.get('assessments', farm.lastAssessmentId);
        if (!a) return;
        try {
            const blob = await FunMap.Owner.Export._pdfFor(farm, firm, a);
            FunMap.Owner.Report.downloadBlob(blob, `${FunMap.Owner.Export._safeName(farm.name)}_${a.month}.pdf`);
        } catch (err) { FunMap.Utils.toast('PDF failed: ' + err.message, 'error'); }
    },

    async _runFarm(farmId) {
        const farm = await FunMap.Owner.Model.getFarm(farmId);
        if (!farm) return;
        const month = new Date().toISOString().substring(0, 7);
        FunMap.Utils.showLoading('RUNNING ' + farm.name.toUpperCase());
        try {
            await FunMap.Owner.Assessment.run(farm, month, s => FunMap.Utils.showLoading(s.toUpperCase()));
        } catch (err) { FunMap.Utils.toast('Run failed: ' + err.message, 'error'); }
        FunMap.Utils.hideLoading();
        await this.refresh();
    },

    async _runPortfolio() {
        const month = new Date().toISOString().substring(0, 7);
        FunMap.Utils.showLoading('RUNNING PORTFOLIO...');
        const result = await FunMap.Owner.Scheduler.runPortfolio(this._portfolioId, month,
            s => FunMap.Utils.showLoading(('RUNNING ' + s).toUpperCase()));
        FunMap.Utils.hideLoading();
        FunMap.Utils.toast(`Portfolio run: ${result.ok} ok, ${result.failed} failed.`,
            result.failed ? 'warning' : 'success', 6000);
        await this.refresh();
    },

    async _export() {
        const month = new Date().toISOString().substring(0, 7);
        FunMap.Utils.showLoading('EXPORTING PDFS...');
        try {
            const r = await FunMap.Owner.Export.portfolioZip(this._portfolioId, month,
                s => FunMap.Utils.showLoading(s.toUpperCase()));
            FunMap.Utils.toast(`Exported ${r.added} report${r.added !== 1 ? 's' : ''}` +
                (r.missing.length ? `; missing: ${r.missing.join(', ')}` : '.'), 'success', 7000);
        } catch (err) { FunMap.Utils.toast(err.message, 'error', 6000); }
        FunMap.Utils.hideLoading();
    },

    async _saveSchedule() {
        const p = await FunMap.Owner.Portfolio.get(this._portfolioId);
        if (!p) return;
        p.scheduleEnabled = document.getElementById('owner-dash-schedule').checked;
        p.scheduleDay = Math.min(28, Math.max(1, parseInt(document.getElementById('owner-dash-schedule-day').value, 10) || 1));
        await FunMap.Owner.Portfolio.save(p);
        FunMap.Utils.toast(p.scheduleEnabled
            ? `Monthly auto-run enabled (day ${p.scheduleDay}, while the app is open).`
            : 'Monthly auto-run disabled.', 'info');
    },
};
