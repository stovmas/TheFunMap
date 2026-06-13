/* ============================================
   OWNER REPORT - Report HTML template + PDF
   ONE template function renders the page; the
   same HTML serves the in-app viewer and the
   PDF (html2pdf). Iterate on layout here.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Report = {
    /**
     * Build the one-page report HTML.
     * imageUrls: { hero, anomaly } object URLs (or null).
     * White-label fields come from the firm record.
     */
    buildHTML(farm, firm, assessment, imageUrls) {
        const N = FunMap.Owner.Narrative;
        const esc = FunMap.Utils.escapeHtml;
        const accent = firm.accentColor || '#2e6e3e';
        const tierColor = N.tierColor(assessment.verdict.tier);
        const flags = N.flagTexts(assessment);
        const weather = N.weatherText(assessment);
        const obsDate = assessment.observations.latestDate
            ? FunMap.Utils.formatDate(assessment.observations.latestDate) : '—';

        return `
<div class="or-page" style="width:816px;min-height:1040px;margin:0 auto;background:#ffffff;color:#222;
     font-family:Georgia,'Times New Roman',serif;display:flex;flex-direction:column;box-sizing:border-box;
     padding:40px 48px;">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${accent};
       padding-bottom:14px;">
    <div>
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${accent};
           font-family:Helvetica,Arial,sans-serif;font-weight:bold;">${esc(firm.displayName)}</div>
      <div style="font-size:26px;font-weight:bold;margin-top:4px;">${esc(farm.name)}</div>
      <div style="font-size:13px;color:#555;margin-top:2px;">
        ${farm.acreage} acres${farm.county ? ' &middot; ' + esc(farm.county) + ' County' : ''}${farm.state ? ', ' + esc(farm.state) : ''}
        ${farm.cropType ? ' &middot; ' + esc(farm.cropType) : ''}
      </div>
    </div>
    <div style="text-align:right;">
      ${imageUrls.logo ? `<img src="${imageUrls.logo}" style="max-height:48px;max-width:160px;margin-bottom:6px;">` : ''}
      <div style="font-size:15px;font-weight:bold;color:#333;">${N.monthName(assessment.month)}</div>
      <div style="display:inline-block;margin-top:6px;padding:4px 12px;border-radius:3px;background:${tierColor};
           color:#fff;font-size:11px;letter-spacing:1px;text-transform:uppercase;
           font-family:Helvetica,Arial,sans-serif;font-weight:bold;">
        ${esc(N.tierLabel(assessment.verdict.tier))}</div>
    </div>
  </div>

  <!-- Hero image -->
  <div style="margin-top:20px;text-align:center;">
    ${imageUrls.hero
        ? `<img src="${imageUrls.hero}" style="max-width:100%;max-height:400px;border:1px solid #ccc;">`
        : `<div style="height:200px;display:flex;align-items:center;justify-content:center;background:#f2f2f2;
             color:#888;font-size:13px;">No clear satellite view available this month</div>`}
    <div style="font-size:10px;color:#888;margin-top:4px;font-family:Helvetica,Arial,sans-serif;">
      Latest clear satellite view &middot; ${obsDate}</div>
  </div>

  <!-- Verdict paragraph -->
  <div style="margin-top:22px;font-size:15px;line-height:1.65;">
    ${esc(N.verdictText(assessment))}
  </div>

  <!-- Flags -->
  ${flags.length > 0 ? `
  <div style="margin-top:16px;padding:14px 16px;background:#fdf6ec;border-left:4px solid #d2691e;">
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#b35c1e;
         font-family:Helvetica,Arial,sans-serif;font-weight:bold;margin-bottom:8px;">
      ${flags.length === 1 ? 'Field Flag' : flags.length + ' Field Flags'}</div>
    <div style="display:flex;gap:16px;align-items:flex-start;">
      <div style="flex:1;font-size:13.5px;line-height:1.6;">
        ${flags.map((f, i) => `<div style="margin-bottom:6px;"><b>${i + 1}.</b> ${esc(f)}</div>`).join('')}
        ${N.flagSummaryText(assessment) ? `<div style="margin-top:6px;font-style:italic;color:#777;">${esc(N.flagSummaryText(assessment))}</div>` : ''}
      </div>
      ${imageUrls.anomaly ? `<img src="${imageUrls.anomaly}"
          style="width:220px;border:1px solid #ccc;flex-shrink:0;">` : ''}
    </div>
  </div>` : (['limited_visibility', 'out_of_season', 'insufficient_data'].includes(assessment.verdict.tier) ? '' : `
  <div style="margin-top:14px;font-size:13.5px;color:#444;">
    ${esc(FunMap.Owner.NarrativeTemplates.noFlags)}
  </div>`)}

  <!-- Spacer pushes footer down -->
  <div style="flex:1;"></div>

  <!-- Footer -->
  <div style="border-top:1px solid #ddd;margin-top:24px;padding-top:10px;font-size:11.5px;color:#666;
       font-family:Helvetica,Arial,sans-serif;">
    ${weather ? `<div style="margin-bottom:4px;">${esc(weather)}</div>` : ''}
    <div style="display:flex;justify-content:space-between;">
      <span>${esc(firm.footerLine || '')}</span>
      <span>Imagery: Copernicus Sentinel-2 &middot; Weather: Open-Meteo/ERA5</span>
    </div>
  </div>
</div>`;
    },

    /** Resolve image object URLs for an assessment (caller revokes). */
    async imageUrls(firm, assessment) {
        const urls = { hero: null, anomaly: null, logo: null, _created: [] };
        const mk = async (key) => {
            const blob = key ? await FunMap.Owner.DB.get('images', key) : null;
            if (!blob) return null;
            const u = URL.createObjectURL(blob);
            urls._created.push(u);
            return u;
        };
        urls.hero = await mk(assessment.images.heroKey);
        urls.anomaly = await mk(assessment.images.anomalyKey);
        urls.logo = await mk(firm.logoKey);
        return urls;
    },

    revoke(urls) { (urls._created || []).forEach(u => URL.revokeObjectURL(u)); },

    /** Render the report to a PDF blob, store it, and return it. */
    async toPdfBlob(farm, firm, assessment) {
        const urls = await this.imageUrls(firm, assessment);
        const holder = document.createElement('div');
        holder.style.cssText = 'position:fixed;left:-2000px;top:0;width:816px;background:#fff;z-index:-1;';
        holder.innerHTML = this.buildHTML(farm, firm, assessment, urls);
        document.body.appendChild(holder);
        try {
            const blob = await html2pdf().from(holder.firstElementChild).set({
                margin: 0,
                image: { type: 'jpeg', quality: 0.92 },
                html2canvas: { scale: 2, useCORS: true, logging: false },
                jsPDF: { unit: 'px', format: [816, 1056], hotfixes: ['px_scaling'] },
            }).outputPdf('blob');
            await FunMap.Owner.DB.put('reports', blob, 'pdf|' + assessment.id);
            return blob;
        } finally {
            document.body.removeChild(holder);
            this.revoke(urls);
        }
    },

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
};
