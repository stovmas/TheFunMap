/* Owner Report Node runner — runs the browser pipeline's pure modules
   directly in Node, with an in-memory DB and proxy-aware fetch.
   Usage: node tools/run-assessment.mjs <geojson-file|'test'> <YYYY-MM> [name]
   Prints the FarmAssessment and owner-facing report text. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');
const GeoTIFF = require('geotiff');

setGlobalDispatcher(new EnvHttpProxyAgent());
globalThis.GeoTIFF = GeoTIFF;

// ---- Load the app's own modules (same files the browser runs) ----
global.window = globalThis;
global.FunMap = {};
const load = f => (0, eval)(readFileSync(new URL('../js/' + f, import.meta.url), 'utf8'));
load('config.js');   // FunMap.Config endpoints (Settings is replaced below)
load('utils.js');
['config.js', 'db.js', 'geometry.js', 'model.js', 'importer.js', 's2.js', 'weather.js',
 'baselines.js', 'anomaly.js', 'flags.js', 'cause.js', 'verdict.js', 'landcover.js',
 'neighbor.js', 'assessment.js', 'narrative-templates.js', 'narrative.js', 'appendix.js']
    .forEach(f => load('owner/' + f));

// ---- Node substitutes for browser-only pieces ----
// In-memory DB with the same surface as the IndexedDB wrapper.
const stores = new Map();
const store = n => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n); };
FunMap.Owner.DB = {
    async put(name, value, key) { store(name).set(key !== undefined ? key : value.key ?? value.id, value); },
    async get(name, key) { return store(name).has(key) ? store(name).get(key) : null; },
    async getAll(name) { return [...store(name).values()]; },
    async getAllByIndex(name, _idx, val) { return [...store(name).values()].filter(r => r.farmId === val); },
    async delete(name, key) { store(name).delete(key); },
    async deleteMany(name, keys) { (keys || []).forEach(k => store(name).delete(k)); },
};
// Image rendering is canvas-based; the Node runner verifies numbers and text.
FunMap.Owner.Render = {
    async buildReportImages() { return { heroKey: null, anomalyKey: null }; },
    async landCoverPreview() { throw new Error('no canvas in Node'); },
};
// Token via the credential-injecting proxy (placeholder is swapped upstream).
FunMap.Settings = {
    get: (k, d) => d, set: () => {}, getApiKey: () => '',
    _tok: null, _exp: 0,
    async getCDSEToken() {
        if (this._tok && Date.now() < this._exp - 60000) return this._tok;
        const r = await fetch(FunMap.Config.CDSE.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic cHJveHk6cHJveHk=' },
            body: new URLSearchParams({ grant_type: 'client_credentials' }),
        });
        if (!r.ok) throw new Error('CDSE auth failed: ' + r.status);
        const d = await r.json();
        this._tok = d.access_token; this._exp = Date.now() + d.expires_in * 1000;
        return this._tok;
    },
};
FunMap.Utils.toast = (m, t) => console.log(`  [${t || 'info'}] ${m}`);
FunMap.Utils.setStatus = () => {};

// ---- Inputs ----
const [, , src, month, name] = process.argv;
if (!src || !month) { console.error('usage: node run-assessment.mjs <geojson|test> YYYY-MM [name]'); process.exit(1); }
const TEST_RING = [  // ~60 ac rectangle on Salinas Valley floor (smoke test)
    [-121.468, 36.552], [-121.462, 36.552], [-121.462, 36.557], [-121.468, 36.557]];
const ring = src === 'test' ? TEST_RING
    : FunMap.Owner.Importer.parseGeoJSON(readFileSync(src, 'utf8'))[0].ring;

// Turf is browser-CDN; Node fallback: skip erosion (use raw ring for analysis).
globalThis.turf = { buffer: () => null };

const farm = await FunMap.Owner.Model.createFarm({
    name: name || (src === 'test' ? 'Salinas Smoke Test' : 'Imported Farm'),
    ring, cropType: 'vegetables',
});
console.log(`Farm: ${farm.name} — ${farm.acreage} ac, centroid ${farm.centroid.map(v => v.toFixed(4))}`);

console.log('Running assessment for', month, '(backfill 2019->present on first run)...');
const t0 = Date.now();
const a = await FunMap.Owner.Assessment.run(farm, month, s => console.log('  ...', s));
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

// ---- Output ----
const N = FunMap.Owner.Narrative;
console.log('=== VERDICT ===');
console.log('tier:', a.verdict.tier, '| capped:', a.verdict.capped, '| meanTier:', a.verdict.meanTier);
console.log('headline:', N.verdictText(a));
console.log('\n=== NUMBERS ===');
console.log('currentMean:', a.verdict.currentMean, '| baseline:', JSON.stringify(a.verdict.selfBaseline));
console.log('pctVsSelf:', a.verdict.pctVsSelf, '| neighbor:', a.verdict.neighborMean, `(${a.neighborSource})`);
console.log('landCover:', JSON.stringify(a.landCover));
console.log('flaggedShare:', a.verdict.flaggedShare, '| analyzed:', a.analyzedAcres, 'ac /', a.analyzedPixels, 'px');
console.log('\n=== FLAGS ===');
a.flags.forEach(f => console.log('-', N.flagTexts({ flags: [f] })[0]));
if (!a.flags.length) console.log('(none)');
console.log('\n=== SCENES (window) ===');
a.scenesTable.forEach(s => console.log(`  ${s.date}  ${String(s.validPct).padStart(3)}%  ${s.used ? 'used' : 'excluded — ' + s.reason}`));
console.log('\n=== BODY TEXT ===\n' + N.bodyText(a));
const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(out + 'assessment.json', JSON.stringify(a, null, 2));
console.log('\nFull FarmAssessment: tools/out/assessment.json');
