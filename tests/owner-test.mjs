/* Owner Report pure-logic tests. Run: node tests/owner-test.mjs */
import { readFileSync } from 'fs';
import assert from 'assert';

global.FunMap = { Utils: { uid: () => 't' + Math.random().toString(36).slice(2, 8), escapeHtml: s => String(s) } };
const load = f => (0, eval)(readFileSync(new URL('../js/owner/' + f, import.meta.url), 'utf8'));
['config.js', 'geometry.js', 'baselines.js', 'anomaly.js', 'flags.js', 'cause.js', 'verdict.js',
 'narrative-templates.js', 'narrative.js', 'importer.js', 'dashboard.js'].forEach(load);

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
