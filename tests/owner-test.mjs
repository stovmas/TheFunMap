/* Owner Report pure-logic tests. Run: node tests/owner-test.mjs */
import { readFileSync } from 'fs';
import assert from 'assert';

global.FunMap = { Utils: { uid: () => 't' + Math.random().toString(36).slice(2, 8), escapeHtml: s => String(s) } };
const load = f => (0, eval)(readFileSync(new URL('../js/owner/' + f, import.meta.url), 'utf8'));
['config.js', 'geometry.js', 'baselines.js', 'anomaly.js', 'flags.js', 'cause.js', 'verdict.js',
 'landcover.js', 'neighbor.js', 'narrative-templates.js', 'narrative.js', 'appendix.js',
 'importer.js', 'dashboard.js'].forEach(load);

const O = FunMap.Owner;
const { Geometry: G, Baselines: B, Anomaly: A, Flags: F, Cause: Ca, Verdict: Ve, Narrative: N, Config: C } = O;
let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); console.log('  PASS ' + name); passed++; };

// ---- Geometry ----
console.log('geometry:');
const sq = [[-84.65, 35.20], [-84.64, 35.20], [-84.64, 35.21], [-84.65, 35.21]];
ok(G.acres(sq) > 220 && G.acres(sq) < 260, `acres of ~1km square (${G.acres(sq).toFixed(1)})`);
ok(G.compassPosition([-84.641, 35.201], sq) === 'southeast corner', 'SE compass');

// ---- Gate 3: duration phrase from actual dates ----
console.log('duration (gate 3):');
const d = (a, b) => F.durationPhrase(a, b);
ok(d('2026-05-20', '2026-05-31') === 'about a week and a half', `3 passes / 11 days -> "${d('2026-05-20','2026-05-31')}"`);
ok(d('2026-05-20', '2026-06-05') === 'about two weeks', `4 passes / 16 days -> "${d('2026-05-20','2026-06-05')}"`);
ok(d('2026-05-01', '2026-06-05') === 'about five weeks', `8 passes / 35 days -> "${d('2026-05-01','2026-06-05')}"`);
ok(d('2026-06-10', '2026-06-13') === 'a few days', 'sub-5-day span -> "a few days"');

// ---- Gates 2 + anomaly: detect, floor, merge ----
console.log('anomaly + flags (gate 2):');
const W = 60, H = 60;
const bbox = [-84.650, 35.2000, -84.6440, 35.2060];          // ~0.0060 x 0.0060 deg
const ring = [[-84.6499, 35.2001], [-84.6441, 35.2001], [-84.6441, 35.2059], [-84.6499, 35.2059]];
const mask = G.rasterMask(ring, bbox, W, H);
const fieldAcres = G.acres(ring);
const cfg = Object.assign({}, C.anomaly, C.flags);

const mkRaster = (date, blobs) => {
    const data = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) data[i] = 0.72 + ((i * 7919) % 11 - 5) / 1500;
    blobs.forEach(([r0, r1, c0, c1, val]) => {
        for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) data[r * W + c] = val;
    });
    return { date, data };
};
// Big depression SE (12x12=144px), tiny one NW (3x3=9px)
const seBlob = [46, 58, 46, 58, 0.32], nwBlob = [4, 7, 4, 7, 0.30];
const dates5 = ['2026-05-18', '2026-05-28', '2026-06-02', '2026-06-07', '2026-06-12'];
const rasters = dates5.map(dt => mkRaster(dt, [seBlob, nwBlob]));
const layer = A.detect(rasters, mask, bbox, W, H, cfg);
const fr = F.build(layer, ring, fieldAcres, cfg);
const pxAc = G.pixelAreaM2(bbox, W, H) * 0.000247105;
ok(fr.flags.length === 1, `tiny 9px (~${(9*pxAc).toFixed(2)}ac) floored, big kept -> ${fr.flags.length} flag`);
ok(fr.flags[0].compass === 'southeast corner', `kept flag in SE ("${fr.flags[0].compass}")`);
ok(fr.flags[0].passCount === 5, `passCount 5 (${fr.flags[0].passCount})`);
ok(fr.flags[0].acres >= 1.0, `kept flag above 1ac floor (${fr.flags[0].acres})`);
ok(N.flagTexts({ flags: fr.flags.map(f => ({ ...f, causeKey: 'unclear' })) })[0]
    .includes(`${fr.flags[0].passCount} consecutive satellite passes`), 'flag prose uses passCount');

// merge: two clusters 2px apart become one
const close = [mkRaster('2026-05-18', [[28, 34, 28, 34, 0.30], [28, 34, 36, 42, 0.30]]),
               mkRaster('2026-05-28', [[28, 34, 28, 34, 0.30], [28, 34, 36, 42, 0.30]]),
               mkRaster('2026-06-02', [[28, 34, 28, 34, 0.30], [28, 34, 36, 42, 0.30]])];
const merged = F.build(A.detect(close, mask, bbox, W, H, cfg), ring, fieldAcres, cfg);
ok(merged.flags.length === 1, `two clusters 2px apart merge into 1 (${merged.flags.length})`);

// cap + summary: 7 well-separated ~1.2ac clusters -> 5 flags + summary of 2
const cells = [];
[2, 22, 42].forEach(r => [2, 22, 42].forEach(c => cells.push([r, c])));
const seven = cells.slice(0, 7).map(([r, c]) => [r, r + 7, c, c + 7, 0.30]);
const many = ['1', '2', '3'].map(t => mkRaster('2026-06-0' + t, seven));
const capped = F.build(A.detect(many, mask, bbox, W, H, cfg), ring, fieldAcres, cfg);
ok(capped.flags.length === 5, `7 clusters -> top 5 in prose (${capped.flags.length})`);
ok(capped.summary && capped.summary.count === 2, `remainder summarized (${capped.summary && capped.summary.count})`);

// no-anomaly control
const clean = F.build(A.detect(dates5.map(dt => mkRaster(dt, [])), mask, bbox, W, H, cfg), ring, fieldAcres, cfg);
ok(clean.flags.length === 0, 'uniform field -> no flags');

// ---- Gate 1: verdict coherence ----
console.log('verdict coherence (gate 1):');
const dv = (meanTier, share, scenes, flags) => Ve.derive(
    { meanTier, flaggedShare: share, validScenes: scenes, hasFlags: flags }, C).tier;
ok(dv('normal', 0.02, 5, true) === 'normal', 'normal mean + 2% flagged -> normal');
ok(dv('normal', 0.07, 5, true) === 'slightly_behind', 'normal mean + 7% flagged -> slightly_behind');
ok(dv('normal', 0.12, 5, true) === 'behind', 'normal mean + 12% flagged -> behind (capped)');
ok(dv('ahead', 0.30, 5, true) === 'significant_concern', 'ahead mean + 30% flagged -> significant_concern');
ok(dv('significant_concern', 0.30, 1, true) === 'limited_visibility', '<2 scenes -> limited_visibility guard');
ok(dv('behind', 0.0, 5, false) === 'behind', 'behind mean, no flags -> behind unchanged');
ok(Ve.derive({ meanTier: 'normal', flaggedShare: 0.12, validScenes: 5, hasFlags: true }, C).capped,
    'capped flag set when share overrides mean');

// ---- Gate 4: evidence-gated cause ----
console.log('cause (gate 4):');
ok(Ca.assign({ departureIn: -1.4 }, 6, 0.7, C.cause) === 'moisture_stress', 'dry -> moisture_stress');
ok(Ca.assign({ departureIn: 0.2 }, 6, 0.7, C.cause) === 'unclear', 'normal precip -> unclear (no invented cause)');
ok(Ca.assign({ departureIn: 1.8 }, 6, 0.7, C.cause) === 'possible_ponding', 'wet -> possible_ponding');
ok(Ca.assign(null, 6, 0.7, C.cause) === 'unclear', 'no weather -> unclear');
ok(Ca.assign({ departureIn: 0.1 }, 5, 0.40, C.cause) === 'emergence_gap', 'early season + low veg -> emergence_gap');
ok(Ca.assign({ departureIn: 0.1 }, 5, 0.80, C.cause) === 'unclear', 'early season but high veg -> unclear');

// ---- Narrative ----
console.log('narrative:');
const baseV = { tier: 'normal', pctVsSelf: 105, pctVsNeighbor: 94, acknowledgesFlags: false, flagCount: 0 };
const verdictOf = v => N.verdictText({ month: '2026-06', verdict: v });
ok(!/NDVI|NDRE|z-score/i.test(verdictOf(baseV)), 'no index names in verdict');
ok(verdictOf({ ...baseV, acknowledgesFlags: true, flagCount: 1 }).includes('though one area stands out'),
    'normal verdict acknowledges its flag');
// neighbor patterns (gate 5 wording)
ok(verdictOf({ tier: 'behind', pctVsSelf: 88, pctVsNeighbor: 99, acknowledgesFlags: false })
    .includes('in line with surrounding farms'), 'behind+regional context');
ok(verdictOf({ tier: 'behind', pctVsSelf: 88, pctVsNeighbor: 82, acknowledgesFlags: false })
    .includes('nearby farms are tracking closer to normal'), 'behind+farm-specific context');
ok(verdictOf({ tier: 'ahead', pctVsSelf: 112, pctVsNeighbor: 115, acknowledgesFlags: false })
    .includes('ahead of surrounding farms'), 'ahead-of-neighbors context');
ok(verdictOf({ tier: 'limited_visibility' }).includes('cloud cover limited'), 'limited-visibility verdict');

const flagText = N.flagTexts({ flags: [{ acres: 9.2, compass: 'southeast corner', passCount: 3,
    firstDate: '2026-05-24', lastDate: '2026-06-14', causeKey: 'moisture_stress' }] })[0];
ok(flagText.includes('9.2-acre') && flagText.includes('southeast corner'), 'flag size + position');
ok(flagText.includes('consistent with moisture stress'), 'gated cause present');
ok(flagText.includes('worth asking the tenant'), 'suggested action');
ok(N.flagSummaryText({ flagSummary: { count: 3, acres: 4.2, region: 'northern edge' } })
    .includes('3 smaller areas totaling ~4.2 acres'), 'remainder summary line');

// ---- Land cover (§7): two-condition temporal signature ----
console.log('landcover:');
const LC = O.LandCover, lcCfg = C.landcover;
// 4 pixels: 0=crop, 1=deciduous forest, 2=pasture, 3=crop
const lcDates = ['2026-03-10', '2026-04-25', '2026-06-15', '2026-08-10', '2026-10-05'];
const series = [
    [0.20, 0.28, 0.80, 0.75, 0.30],   // crop: tilled/bare in season, big amplitude
    [0.38, 0.55, 0.85, 0.82, 0.60],   // deciduous: amplitude 0.47 BUT never bare Apr-Oct
    [0.55, 0.60, 0.66, 0.62, 0.56],   // pasture: low amplitude
    [0.25, 0.30, 0.78, 0.70, 0.28],   // crop
];
const lcRasters = lcDates.map((date, t) => ({ date, data: new Float32Array(series.map(px => px[t])) }));
const lcMask = new Uint8Array([1, 1, 1, 1]);
const cls = LC.classifyPixels(lcRasters, lcMask, 4, lcCfg);
ok(cls.cropMask[0] === 1 && cls.cropMask[3] === 1, 'crop pixels classified cropland');
ok(cls.cropMask[1] === 0, 'deciduous forest REJECTED (amplitude alone is not enough)');
ok(cls.cropMask[2] === 0, 'pasture not cropland (override path exists for it)');
ok(Math.abs(cls.share - 0.5) < 1e-9, `share = 0.5 (${cls.share})`);
ok(LC.classifyPixels(lcRasters.slice(0, 2), lcMask, 4, lcCfg).classified === false,
    'too little history -> pass-through, marked unclassified');
// Gate math (Virginia-style mixed boundary must block)
ok(0.32 < lcCfg.blockShare, 'a ~32%-cropland rectangle falls below the 40% block gate');
ok(LC.isCropCode(1, lcCfg.cdlCropRanges) && LC.isCropCode(61, lcCfg.cdlCropRanges), 'CDL corn+fallow are crop');
ok(!LC.isCropCode(141, lcCfg.cdlCropRanges) && !LC.isCropCode(176, lcCfg.cdlCropRanges),
    'CDL forest+pasture are not crop');
const [ax, ay] = LC.toAlbers5070(-96, 23);
ok(Math.abs(ax) < 1 && Math.abs(ay) < 1, `Albers 5070 origin maps to (0,0) (${ax.toFixed(2)},${ay.toFixed(2)})`);
ok(LC.parseCdlStats('[{"value":1,"acreage":100},{"value":121,"acreage":50}]').length === 2, 'CDL JSON rows parsed');
ok(LC.parseCdlStats('<Row>1, 4046856.0, 1000.0</Row><Row>141, 80937.1, 20.0</Row>')
    .map(r => r.value).join(',') === '1,141', 'CDL XML Row format parsed');

// ---- Neighbor (§5): masked mean + donut geometry ----
console.log('neighbor:');
const NB = O.Neighbor;
const mm = NB._maskedMean(new Float32Array([0.5, 0.7, NaN, 0.9]), new Uint8Array([1, 1, 1, 0]), 4);
ok(Math.abs(mm.mean - 0.6) < 1e-6 && mm.count === 2, 'masked mean skips NaN and unmasked');
const nbCfg = { innerGapM: 150, outerRingM: 3000 };
const rb = G.bbox(ring, 3000 / 111320 * 1.05);
const rw = 120, rh = 120;
const ringM = NB._ringMask(ring, rb, rw, rh, nbCfg);
const centerIdx = (r, c) => r * rw + c;
ok(ringM[centerIdx(60, 60)] === 0, 'donut excludes the field itself');
let ringCount = 0; for (let i = 0; i < rw * rh; i++) ringCount += ringM[i];
ok(ringCount > rw * rh * 0.3, `donut has substantial area (${ringCount}px)`);
ok(ringM[centerIdx(0, 0)] === 0, 'corner beyond 3km radius excluded');

// ---- Floor decision D math ----
console.log('floor (decision D):');
ok(Math.max(C.flags.minAcresFloor, C.flags.minShareFloor * 24.6) === 0.5, 'TN 24.6ac -> 0.5ac floor (ponding survives)');
ok(Math.abs(Math.max(C.flags.minAcresFloor, C.flags.minShareFloor * 374.9) - 1.8745) < 1e-9,
    'Arkansas 374.9ac -> ~1.87ac floor (0.3ac noise stays dead)');
ok(fr.flags[0].rankComponents && fr.flags[0].rankComponents.passes === 5, 'rank components persisted (decision C)');

// ---- Appendix (§8): populated from the assessment, omits missing ----
console.log('appendix:');
const Ap = O.Appendix;
const apFarm = { name: 'Test Farm', acreage: 374.9, centroid: [-91.5, 34.8] };
const apBase = {
    id: 'r1', month: '2026-06', generatedAt: '2026-06-13T01:00:00.000Z', version: C.version,
    verdict: { tier: 'behind', currentMean: 0.61, selfBaseline: { mean: 0.7, std: 0.05, years: ['2019', '2025'] },
        neighborMean: 0.65, neighborSamples: 1200 },
    neighborSource: 'ring-proxy',
    landCover: { source: 'proxy', year: null, croplandShare: 0.91, maskApplied: false },
    observations: { latestDate: '2026-06-10' },
    scenesTable: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-06-${String(i + 1).padStart(2, '0')}`, validPct: 80, used: true, reason: '' })),
    analyzedAcres: 360.2, analyzedPixels: 14580,
    weather: { monthPrecipIn: 2.1 },
};
const model = Ap.buildModel(apFarm, apBase, C);
ok(model.scenes.length === 10, `scene table capped at 10 (${model.scenes.length})`);
ok(model.sources.some(s => s.includes('temporal-signature proxy')), 'appendix states proxy mask source');
ok(model.numbers.some(s => s.includes('z = -1.8')), 'z-score computed from baseline');
ok(model.numbers.some(s => s.includes('cropland within ~3 km')), 'neighbor method stated');
const noNeighbor = Ap.buildModel(apFarm, { ...apBase,
    verdict: { ...apBase.verdict, neighborMean: null } }, C);
ok(!noNeighbor.numbers.some(s => s.includes('Neighbor benchmark')), 'neighbor line omitted when not computed');
const cdlModel = Ap.buildModel(apFarm, { ...apBase,
    landCover: { source: 'cdl', year: 2025, croplandShare: 0.91, maskApplied: true } }, C);
ok(cdlModel.sources.some(s => s.includes('USDA Cropland Data Layer 2025')), 'CDL source line when CDL ran');
const confModel = Ap.buildModel(apFarm, { ...apBase,
    landCover: { source: 'confirmed', croplandShare: 0.3, maskApplied: false } }, C);
ok(confModel.sources.some(s => s.includes('confirmed by manager')), 'manager-confirmed line');
const html2 = Ap.buildHTML(apFarm, apBase, '#2e6e3e');
ok(html2.includes('Methodology') && html2.includes('Contains modified Copernicus Sentinel data 2026'),
    'appendix HTML renders with attribution');

// ---- Dashboard triage ----
console.log('dashboard:');
const D = O.Dashboard;
ok(D.severityScore({ verdict: { tier: 'normal' }, flags: [{ severity: 'moderate' }] }) >
   D.severityScore({ verdict: { tier: 'behind' }, flags: [] }), 'flag outranks behind');
ok(D.sparklineSvg([{ v: 0.3 }, { v: 0.6 }]).includes('polyline'), 'sparkline renders');

// ---- Importer ----
console.log('importer:');
ok(O.Importer.parseGeoJSON(JSON.stringify({ type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1]]] })).length === 1, 'bare Polygon parsed');

console.log(`\nALL ${passed} TESTS PASSED`);
