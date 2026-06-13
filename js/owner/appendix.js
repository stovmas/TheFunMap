/* ============================================
   OWNER REPORT - Methodology appendix (§8)
   Page 2 of the PDF: data provenance for the
   skeptical expert. Every line is populated
   from the actual FarmAssessment; lines whose
   value wasn't computed are omitted.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Appendix = {
    /** Pure: assemble the appendix data model (Node-tested). */
    buildModel(farm, assessment, cfg) {
        const v = assessment.verdict;
        const lc = assessment.landCover || null;
        const m = {
            sources: [
                'Imagery: Copernicus Sentinel-2 Level-2A (ESA), 10 m resolution, atmospherically corrected surface reflectance.',
                `Cloud screening: Scene Classification Layer (SCL); scenes with < ${Math.round(cfg.minValidFraction * 100)}% valid field pixels excluded.`,
            ],
            scenes: (assessment.scenesTable || []).slice(0, 10),
            geometry: [],
            numbers: [],
            method: [],
            limitations: [
                `10 m optical resolution (~0.025 ac/pixel); features below ~${cfg.flags.minAcresFloor} ac are unreliable and are not reported.`,
                'Optical imagery is blocked by cloud; analysis uses only cloud-free passes.',
                'Vegetation index saturates in dense canopy; very high readings compress differences.',
                'Weather is gridded reanalysis (~25 km), not an on-farm gauge.',
            ],
            meta: {
                generatedAt: assessment.generatedAt,
                version: assessment.version || cfg.version,
                reportId: assessment.id,
                attributionYear: (assessment.observations.latestDate || assessment.month).substring(0, 4),
            },
        };

        if (assessment.weather) {
            const [lng, lat] = farm.centroid;
            m.sources.push(`Weather: Open-Meteo (ERA5 reanalysis), queried at field centroid [${lat.toFixed(4)}, ${lng.toFixed(4)}].`);
        }
        if (lc && lc.source === 'cdl') {
            m.sources.push(`Cropland mask: USDA Cropland Data Layer ${lc.year}${lc.maskApplied ? ' (applied)' : ''}.`);
        } else if (lc && lc.source === 'proxy') {
            m.sources.push('Cropland mask: temporal-signature proxy (seasonal amplitude + in-season bare-soil event), derived from this field’s Sentinel-2 history. USDA CDL unavailable from this client.');
        } else if (lc && lc.source === 'confirmed') {
            m.sources.push('Land cover confirmed by manager; no automated cropland mask applied.');
        }

        // Field geometry
        m.geometry.push(`Polygon area: ${farm.acreage} acres.`);
        m.geometry.push(`${cfg.edgeBufferMeters} m inward buffer applied to exclude mixed edge pixels.`);
        if (assessment.analyzedAcres !== undefined && assessment.analyzedAcres !== null) {
            const maskNote = lc && lc.maskApplied
                ? ` (analysis restricted to ${assessment.analyzedAcres} of ${farm.acreage} acres classified as cropland)` : '';
            m.geometry.push(`Analyzed area: ${assessment.analyzedAcres} acres / ${assessment.analyzedPixels} pixels at 10 m${maskNote}.`);
        }
        if (lc && lc.maskApplied) {
            m.geometry.push('Self-comparison uses the full buffered boundary (consistent across years); sub-field and neighbor analysis use cropland-classified pixels only.');
        }

        // The numbers behind the verdict
        if (v.currentMean !== null && v.currentMean !== undefined) {
            m.numbers.push(`Current field mean NDVI: ${v.currentMean}.`);
        }
        if (v.selfBaseline) {
            const yrs = v.selfBaseline.years;
            m.numbers.push(`Baseline for this calendar window: ${v.selfBaseline.mean} ± ${v.selfBaseline.std} ` +
                `(${yrs[0]}–${yrs[yrs.length - 1]}).`);
            if (v.currentMean !== null && v.selfBaseline.std > 0) {
                const z = (v.currentMean - v.selfBaseline.mean) / v.selfBaseline.std;
                m.numbers.push(`Departure from baseline: z = ${(Math.round(z * 100) / 100)}.`);
            }
        }
        if (v.neighborMean !== null && v.neighborMean !== undefined) {
            const src = assessment.neighborSource === 'ring-proxy'
                ? `cropland within ~3 km, ${v.neighborSamples} pixels minimum per scene, same acquisition dates as the field`
                : `${v.neighborSamples || ''} manager-drawn comparison field(s)`;
            m.numbers.push(`Neighbor benchmark mean NDVI: ${v.neighborMean} (${src}).`);
        }
        m.numbers.push('Comparison logic: current mean vs. the same calendar window in prior years; flagged-area share caps the verdict tier.');

        // Flag method
        m.method.push(`Sub-field analysis on 10 m pixels: a pixel is flagged when its z-score vs. the field mean is below ${cfg.anomaly.zThreshold} AND it sits at least ${cfg.anomaly.minNdviDeficit} NDVI below the field mean, persisting across ≥ ${cfg.anomaly.minConsecutiveDates} consecutive valid passes.`);
        m.method.push(`Adjacent clusters within ~${cfg.flags.mergeGapPx * 10} m merge; minimum reported area max(${cfg.flags.minAcresFloor} ac, ${cfg.flags.minShareFloor * 100}% of field); severity ranked by area × mean |z| × pass count.`);
        m.method.push('Satellite analysis identifies where vegetation lags; it cannot determine why. Cause language indicates consistency with weather data, not diagnosis.');

        return m;
    },

    /** HTML for page 2 (quiet, colophon-like). */
    buildHTML(farm, assessment, accent) {
        const esc = FunMap.Utils.escapeHtml;
        const m = this.buildModel(farm, assessment, FunMap.Owner.Config);
        const sec = (title, lines) => lines.length ? `
  <div style="margin-top:14px;">
    <div style="font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:#555;
         font-family:Helvetica,Arial,sans-serif;font-weight:bold;margin-bottom:4px;">${title}</div>
    ${lines.map(l => `<div style="margin-bottom:2px;">${esc(l)}</div>`).join('')}
  </div>` : '';

        const sceneRows = m.scenes.map(s => `
      <tr>
        <td style="padding:2px 10px 2px 0;">${esc(s.date)}</td>
        <td style="padding:2px 10px 2px 0;text-align:right;">${s.validPct}%</td>
        <td style="padding:2px 0;">${s.used ? 'used' : 'excluded — ' + esc(s.reason)}</td>
      </tr>`).join('');

        return `
<div class="or-page" style="width:816px;min-height:1040px;margin:0 auto;background:#ffffff;color:#333;
     font-family:Georgia,'Times New Roman',serif;font-size:11.5px;line-height:1.55;
     box-sizing:border-box;padding:48px 56px;display:flex;flex-direction:column;">
  <div style="border-bottom:2px solid ${accent};padding-bottom:8px;">
    <div style="font-size:13px;font-weight:bold;">Methodology &amp; Data Provenance</div>
    <div style="font-size:10px;color:#777;">${esc(farm.name)} — ${esc(FunMap.Owner.Narrative.monthName(assessment.month))} report</div>
  </div>
  ${sec('Data sources', m.sources)}
  ${m.scenes.length ? `
  <div style="margin-top:14px;">
    <div style="font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:#555;
         font-family:Helvetica,Arial,sans-serif;font-weight:bold;margin-bottom:4px;">Scenes used this period</div>
    <table style="border-collapse:collapse;font-size:10.5px;font-family:Helvetica,Arial,sans-serif;color:#444;">
      <tr style="color:#888;"><td style="padding-right:10px;">acquisition</td><td style="padding-right:10px;text-align:right;">valid px</td><td>status</td></tr>
      ${sceneRows}
    </table>
  </div>` : ''}
  ${sec('Field geometry', m.geometry)}
  ${sec('The numbers behind the verdict', m.numbers)}
  ${sec('Flag method', m.method)}
  ${sec('Limitations', m.limitations)}
  <div style="flex:1;"></div>
  <div style="border-top:1px solid #ddd;margin-top:18px;padding-top:8px;font-size:9.5px;color:#888;
       font-family:Helvetica,Arial,sans-serif;display:flex;justify-content:space-between;">
    <span>Generated ${esc(m.meta.generatedAt.replace('T', ' ').substring(0, 16))} UTC · ${esc(m.meta.version)} · report ${esc(m.meta.reportId)}</span>
    <span>Contains modified Copernicus Sentinel data ${esc(m.meta.attributionYear)}</span>
  </div>
</div>`;
    },
};
