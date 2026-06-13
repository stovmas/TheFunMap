/* ============================================
   OWNER REPORT - Batch PDF export
   Zips one month of reports for a portfolio —
   the artifact a firm actually mails out.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Export = {
    _safeName(s) {
        return String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'farm';
    },

    /** Assessment for a farm in a given month (latest if several) */
    async _assessmentFor(farmId, monthStr) {
        const rows = await FunMap.Owner.DB.getAllByIndex('assessments', 'farmId', farmId);
        const inMonth = rows.filter(a => a.month === monthStr)
            .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
        return inMonth[0] || null;
    },

    /** Stored PDF if present, else render (and store) one. */
    async _pdfFor(farm, firm, assessment) {
        const stored = await FunMap.Owner.DB.get('reports', 'pdf|' + assessment.id);
        if (stored) return stored;
        return FunMap.Owner.Report.toPdfBlob(farm, firm, assessment);
    },

    /**
     * Build and download a zip of every available report in the
     * portfolio for monthStr. Returns { added, missing }.
     */
    async portfolioZip(portfolioId, monthStr, onStatus) {
        const say = onStatus || (() => {});
        const firm = await FunMap.Owner.Model.ensureDefaultFirm();
        const portfolio = await FunMap.Owner.Portfolio.get(portfolioId);
        const farms = await FunMap.Owner.Portfolio.farmsIn(portfolioId);

        const zip = new JSZip();
        let added = 0;
        const missing = [];

        for (let i = 0; i < farms.length; i++) {
            const farm = farms[i];
            say(`PDF ${i + 1}/${farms.length}: ${farm.name}`);
            const assessment = await this._assessmentFor(farm.id, monthStr);
            if (!assessment) { missing.push(farm.name); continue; }
            try {
                const blob = await this._pdfFor(farm, firm, assessment);
                zip.file(`${this._safeName(farm.name)}_${monthStr}.pdf`, blob);
                added++;
            } catch (err) {
                console.error(`PDF failed for ${farm.name}:`, err);
                missing.push(farm.name + ' (render failed)');
            }
        }

        if (added === 0) {
            throw new Error('No reports available for ' + monthStr + ' — run the portfolio first.');
        }

        say('Building zip...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const pname = this._safeName(portfolio ? portfolio.name : 'portfolio');
        FunMap.Owner.Report.downloadBlob(zipBlob, `${pname}_${monthStr}_reports.zip`);
        return { added, missing };
    },
};
