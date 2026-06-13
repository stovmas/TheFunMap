/* Owner Report pure-logic tests. Run: node tests/owner-test.mjs */
import { readFileSync } from 'fs';
import assert from 'assert';

global.FunMap = { Utils: { uid: () => 't' + Math.random().toString(36).slice(2, 8), escapeHtml: s => String(s) } };
const load = f => (0, eval)(readFileSync(new URL('../js/owner/' + f, import.meta.url), 'utf8'));
['config.js', 'geometry.js', 'baselines.js', 'anomaly.js', 'narrative-templates.js', 'narrative.js', 'importer.js']
    .forEach(load);

const { Geometry: G, Baselines: B, Anomaly: A, Narrative: N, Importer: I, Config: C } = FunMap.Owner;
let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); console.log('  PASS ' + name); passed++; };

// ---- Geometry ----
console.log('geometry:');
const sq = [[-84.65, 35.20], [-84.64, 35.20], [-84.64, 35.21], [-84.65, 35.21]]; // ~1km x ~0.9km
const ac = G.acres(sq);
ok(ac > 220 && ac < 260, `acres of ~1km square plausible (${ac.toFixed(1)})`);
ok(G.pointInRing([-84.645, 35.205], sq), 'centroid inside ring');
ok(!G.pointInRing([-84.66, 35.205], sq), 'outside point excluded');
const se = G.compassPosition([-84.641, 35.201], sq);
ok(se === 'southeast corner', `SE point -> "${se}"`);
ok(G.compassPosition([-84.645, 35.205], sq) === 'center of the field', 'center phrase');

// ---- Baselines ----
console.log('baselines:');
const rows = [];
for (let y = 2019; y <= 2025; y++) {
    for (const d of ['06-05', '06-15', '06-25']) {
        rows.push({ date: `${y}-${d}`, ndviMean: 0.70 + (y % 3) * 0.01, validFraction: 0.95 });
    }
}
rows.push({ date: '2026-06-10', ndviMean: 0.66, validFraction: 0.9 });
rows.push({ date: '2026-06-14', ndviMean: 0.67, validFraction: 0.9 });
const valid = B.validRows(rows, 0.7);
const base = B.selfBaseline(valid, '2026-06-15', 20, 2026);
ok(base && Math.abs(base.mean - 0.71) < 0.02, `self baseline ~0.71 (${base.mean.toFixed(3)})`);
ok(base.years.length === 7, 'seven baseline years');
const cur = B.currentValue(valid, '2026-06-01', '2026-06-30', 3);
ok(Math.abs(cur.mean - 0.665) < 0.001, 'current mean from recent passes');
ok(B.verdictTier(0.94 * base.mean, base, C.verdict) === 'normal', 'ratio 0.94 -> normal');
ok(B.verdictTier(0.88 * base.mean, base, C.verdict) === 'slightly_behind', '0.88 -> slightly_behind');
ok(B.verdictTier(0.5, { mean: 0.2, std: 0.05 }, C.verdict) === 'out_of_season', 'low baseline -> out_of_season');

// ---- Anomaly detection (synthetic ground truth) ----
console.log('anomaly:');
const W = 45, H = 40;
const bbox = [-84.650, 35.2050, -84.6450, 35.2090];
const ring = [[-84.6499, 35.2051], [-84.6451, 35.2051], [-84.6451, 35.2089], [-84.6499, 35.2089]];
const mask = G.rasterMask(ring, bbox, W, H);
ok(mask.reduce((s, v) => s + v, 0) > W * H * 0.9, 'mask covers most of grid');

const mkRaster = (date, depressed) => {
    const data = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) data[i] = 0.70 + ((i * 7919) % 13 - 6) / 1300;
    if (depressed) {
        for (let r = 30; r < 35; r++) for (let c = 36; c < 41; c++) data[r * W + c] = 0.30;
    }
    return { date, data };
};
const rasters = ['2026-05-20', '2026-05-30', '2026-06-04', '2026-06-09', '2026-06-14']
    .map(d => mkRaster(d, true));
const det = A.detect(rasters, mask, bbox, W, H, ring, C.anomaly);
ok(det.flags.length === 1, `exactly one cluster flagged (${det.flags.length})`);
const f = det.flags[0];
ok(f.pixels.length === 25, `cluster is 25 px (${f.pixels.length})`);
ok(f.compass === 'southeast corner', `cluster compass "${f.compass}"`);
ok(f.durationObs >= 3, `persistence >= 3 obs (${f.durationObs})`);
ok(f.spanDays >= 20, `span covers weeks (${f.spanDays}d)`);
ok(f.severity === 'severe', `deep depression severe (${f.severity}, z=${f.meanZ})`);
ok(f.acres > 0.3 && f.acres < 1.2, `acreage plausible (${f.acres} ac)`);

// No-anomaly control: uniform field must produce zero flags
const clean = A.detect(rasters.map(r => mkRaster(r.date, false)), mask, bbox, W, H, ring, C.anomaly);
ok(clean.flags.length === 0, 'uniform field -> no flags');

// ---- Narrative ----
console.log('narrative:');
const assessment = {
    month: '2026-06',
    verdict: { tier: 'normal', pctVsNeighbor: 94, pctVsSelf: 105, nComps: 3 },
    observations: { latestDate: '2026-06-14' },
    flags: [{ id: 'flag1', acres: 9.2, compass: 'southeast corner', durationObs: 3,
        spanDays: 21, severity: 'moderate', meanZ: 1.5, causeHint: 'ponding', dates: [] }],
    weather: { monthPrecipIn: 4.1, normalIn: 3.1, departureIn: 1.0, partialMonth: false },
};
const verdict = N.verdictText(assessment);
ok(verdict.includes('94% of comparable nearby fields'), 'verdict cites neighbor %');
ok(verdict.includes('slightly ahead') && verdict.includes('mid-June'), 'verdict cites self window');
ok(!/NDVI|NDRE/i.test(verdict), 'no index names in verdict');
const flagText = N.flagTexts(assessment)[0];
ok(flagText.includes('9.2-acre') && flagText.includes('southeast corner'), 'flag has size + position');
ok(flagText.includes('3 consecutive satellite passes') && flagText.includes('3 weeks'), 'flag has duration');
ok(flagText.includes('consistent with ponding'), 'flag has cause as possibility');
ok(flagText.includes('worth asking the tenant'), 'flag has suggested action');
const wx = N.weatherText(assessment);
ok(wx.includes('4.1"') && wx.includes('above normal'), `weather line ok ("${wx}")`);
ok(N.verdictText({ month: '2026-03', verdict: { tier: 'out_of_season' }, flags: [] })
    .includes('between growing seasons'), 'out-of-season verdict');

// ---- Importer ----
console.log('importer:');
const gj = JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: 'Test Parcel' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] } }],
});
const specs = I.parseGeoJSON(gj);
ok(specs.length === 1 && specs[0].name === 'Test Parcel', 'FeatureCollection parsed');
ok(specs[0].ring.length === 4, 'closing duplicate vertex dropped');
ok(I.parseGeoJSON(JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] })).length === 1,
    'bare Polygon accepted');
assert.throws(() => I.parseGeoJSON('{"type":"Point"}'), /No polygon|Expected/, '');
ok(true, 'non-polygon rejected');

console.log(`\nALL ${passed} TESTS PASSED`);
