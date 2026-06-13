/* ============================================
   OWNER REPORT - Configuration & thresholds
   All tunable numbers and evalscripts live here.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Config = {
    // ---- Endpoints ----
    statsEndpoint: 'https://sh.dataspace.copernicus.eu/api/v1/statistics',
    weatherEndpoint: 'https://archive-api.open-meteo.com/v1/archive',

    // ---- Geometry ----
    edgeBufferMeters: 12,         // inward erosion before any statistics
    rasterResDeg: 0.0001,         // ~10m at mid-latitudes (EPSG:4326)
    rasterPadDeg: 0.0003,         // bbox padding around farm for rasters
    heroImageMaxEdge: 900,        // rendered report image size

    // ---- Scene validity ----
    minValidFraction: 0.70,       // discard dates with <70% valid pixels
    backfillStart: '2019-01-01',

    // ---- Anomaly detection (per-pixel z + clustering) ----
    anomaly: {
        zThreshold: -1.0,         // pixel flagged when z < this...
        minNdviDeficit: 0.08,     // ...AND at least this far below farm mean
        minConsecutiveDates: 3,   // persistence across valid observations
        minClusterPixels: 8,      // ~0.2 acres at 10m pixels
        analysisDates: 8,         // most recent valid dates to analyze
        severityModerateZ: 1.3,   // mean |z| boundaries
        severitySevereZ: 1.8,
    },

    // ---- Verdict tiers: currentMean / selfBaselineMean ratio ----
    verdict: {
        aheadRatio: 1.05,
        normalRatio: 0.92,
        slightlyBehindRatio: 0.85,
        behindRatio: 0.70,        // below this = significant concern
        outOfSeasonNdvi: 0.35,    // self-baseline below this => "between seasons"
        // Coherence: flagged share of field caps the mean-based verdict
        behindShare: 0.10,        // >=10% flagged => at best "Behind"
        concernShare: 0.25,       // >=25% flagged => "Significant concern"
        normalMaxShare: 0.05,     // "Normal" needs <5% flagged
    },

    // ---- Flag floor / merge / cap / ranking ----
    flags: {
        minAcresFloor: 0.5,       // discard clusters below max(this, share floor)
        minShareFloor: 0.005,     // ...or below 0.5% of field area
        mergeGapPx: 3,            // clusters within ~30m merge into one flag
        maxReported: 5,          // prose enumerates at most this many
    },

    // ---- Land cover gate (§7): CDL when reachable, temporal proxy fallback ----
    landcover: {
        maskShare: 0.80,          // below this: analysis restricted to cropland px
        blockShare: 0.40,         // below this: block report, ask for retrace
        // Temporal-signature proxy: cropland = seasonal amplitude AND an
        // in-season bare-soil event (deciduous forest has amplitude but its
        // canopy never reads bare in season; crops get tilled/harvested).
        amplitudeMin: 0.30,
        bareSoilNdvi: 0.35,
        bareSoilMonths: [4, 10],  // April..October inclusive
        proxyDates: 12,           // historical rasters sampled for the signature
        cdlTimeoutMs: 8000,
        // NASS CDL cultivated-crop category code ranges
        cdlCropRanges: [[1, 61], [66, 80], [195, 255]],
        conusBbox: [-125, 24, -66, 50],
    },

    // ---- Evidence-gated cause attribution ----
    cause: {
        dryDepartureIn: -1.0,     // <= this => "moisture stress"
        wetDepartureIn: 1.5,      // >= this => "possible ponding"
        earlySeasonMonths: [4, 5],// emergence-gap language allowed only here
        earlySeasonMaxMean: 0.45, // ...and only when overall vegetation is low
    },

    // ---- Data-confidence guard ----
    confidence: {
        minScenes: 2,             // < this valid scenes => "limited visibility"
    },

    // ---- Neighbor benchmark (donut ring, cropland-masked) ----
    neighbor: {
        innerGapM: 150,           // gap between field edge and ring inner radius
        outerRingM: 3000,         // ring outer radius (~3 km)
        minRingCroplandShare: 0.30, // sufficiency gate on the ring
        minMaskedPixels: 500,     // omit comparison below this masked sample
        ringResDeg: 0.0003,       // ~30m ring grid (cost control)
    },

    // ---- Pipeline identity (appendix) ----
    version: 'owner-report/0.2.0',

    // ---- Weather ----
    weatherNormalYears: [1991, 2020],   // inclusive range for "normal"
    weatherWetDepartureIn: 1.0,         // +1in => ponding cause hint
    weatherDryDepartureIn: -1.0,        // -1in => moisture stress hint

    // ---- Statistical API evalscript: NDVI + NDRE, SCL cloud-masked ----
    // Water (SCL 6) stays VALID so ponding shows up as low NDVI.
    STATS_EVALSCRIPT: `//VERSION=3
function setup() {
    return {
        input: [{ bands: ["B04", "B05", "B08", "SCL", "dataMask"] }],
        output: [
            { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
            { id: "ndre", bands: 1, sampleType: "FLOAT32" },
            { id: "dataMask", bands: 1 }
        ]
    };
}
function maskOk(scl) {
    // mask: nodata, saturated, cloud shadow, cloud med/high, cirrus, snow
    return !(scl === 0 || scl === 1 || scl === 3 || scl === 8 ||
             scl === 9 || scl === 10 || scl === 11);
}
function evaluatePixel(s) {
    var valid = s.dataMask === 1 && maskOk(s.SCL) ? 1 : 0;
    var ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-9);
    var ndre = (s.B08 - s.B05) / (s.B08 + s.B05 + 1e-9);
    return { ndvi: [ndvi], ndre: [ndre], dataMask: [valid] };
}`,

    // ---- Process API evalscript: FLOAT32 NDVI raster, NaN where masked ----
    RASTER_EVALSCRIPT: `//VERSION=3
function setup() {
    return {
        input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
        output: { bands: 1, sampleType: "FLOAT32" }
    };
}
function evaluatePixel(s) {
    var bad = s.dataMask !== 1 || s.SCL === 0 || s.SCL === 1 || s.SCL === 3 ||
              s.SCL === 8 || s.SCL === 9 || s.SCL === 10 || s.SCL === 11;
    if (bad) return [NaN];
    return [(s.B08 - s.B04) / (s.B08 + s.B04 + 1e-9)];
}`,

    // ---- Hero render: true color, gentle gain ----
    HERO_EVALSCRIPT: `//VERSION=3
function setup() {
    return { input: ["B02", "B03", "B04", "dataMask"], output: { bands: 4 } };
}
function evaluatePixel(s) {
    return [2.5 * s.B04, 2.5 * s.B03, 2.5 * s.B02, s.dataMask];
}`,
};
