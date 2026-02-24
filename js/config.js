/* ============================================
   THE FUN MAP - Configuration
   ============================================ */

const FunMap = window.FunMap || {};
window.FunMap = FunMap;

FunMap.Config = {
    // Copernicus Data Space Ecosystem (Sentinel Hub)
    CDSE: {
        tokenEndpoint: 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
        processEndpoint: 'https://sh.dataspace.copernicus.eu/api/v1/process',
        catalogEndpoint: 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search',
        wmsBase: 'https://sh.dataspace.copernicus.eu/ogc/wms/',
    },

    // NASA FIRMS
    FIRMS: {
        areaEndpoint: 'https://firms.modaps.eosdis.nasa.gov/api/area',
        sources: {
            'VIIRS_SNPP_NRT': 'VIIRS S-NPP',
            'VIIRS_NOAA20_NRT': 'VIIRS NOAA-20',
            'MODIS_NRT': 'MODIS',
        },
    },

    // ACLED
    ACLED: {
        endpoint: 'https://acleddata.com/api/acled/read',
    },

    // UCDP GED (no key required)
    UCDP: {
        endpoint: 'https://ucdpapi.pcr.uu.se/api/gedevents/25.1',
    },

    // GDELT (no key required)
    GDELT: {
        geoEndpoint: 'https://api.gdeltproject.org/api/v2/geo/geo',
    },

    // Base map tile URLs
    BaseMaps: {
        dark: {
            url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            name: 'Dark',
            className: 'dark-xbox-tiles',
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; Esri, Maxar, Earthstar, USDA, USGS, AeroGRID, IGN',
            name: 'Satellite',
        },
        osm: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            name: 'Street',
        },
        terrain: {
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
            name: 'Terrain',
        },
    },

    // Sentinel-2 evalscripts
    S2Evalscripts: {
        TRUE_COLOR: `//VERSION=3
function setup() {
    return {
        input: ["B02", "B03", "B04", "dataMask"],
        output: { bands: 4 }
    };
}
function evaluatePixel(s) {
    return [2.5*s.B04, 2.5*s.B03, 2.5*s.B02, s.dataMask];
}`,
        FALSE_COLOR: `//VERSION=3
function setup() {
    return {
        input: ["B03", "B04", "B08", "dataMask"],
        output: { bands: 4 }
    };
}
function evaluatePixel(s) {
    return [2.5*s.B08, 2.5*s.B04, 2.5*s.B03, s.dataMask];
}`,
        NDVI: `//VERSION=3
function setup() {
    return {
        input: ["B04", "B08", "dataMask"],
        output: { bands: 4 }
    };
}
function evaluatePixel(s) {
    let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
    let r, g, b;
    if (ndvi < -0.2) { r=0.05; g=0.05; b=0.05; }
    else if (ndvi < 0.0) { r=0.75; g=0.75; b=0.75; }
    else if (ndvi < 0.1) { r=0.86; g=0.86; b=0.76; }
    else if (ndvi < 0.2) { r=0.92; g=0.92; b=0.6; }
    else if (ndvi < 0.3) { r=0.85; g=0.85; b=0.42; }
    else if (ndvi < 0.4) { r=0.65; g=0.82; b=0.28; }
    else if (ndvi < 0.5) { r=0.45; g=0.72; b=0.18; }
    else if (ndvi < 0.6) { r=0.19; g=0.55; b=0.13; }
    else if (ndvi < 0.7) { r=0.08; g=0.45; b=0.06; }
    else { r=0.0; g=0.35; b=0.0; }
    return [r, g, b, s.dataMask];
}`,
        NDWI: `//VERSION=3
function setup() {
    return {
        input: ["B03", "B08", "dataMask"],
        output: { bands: 4 }
    };
}
function evaluatePixel(s) {
    let ndwi = (s.B03 - s.B08) / (s.B03 + s.B08);
    let r, g, b;
    if (ndwi > 0.5) { r=0.0; g=0.0; b=1.0; }
    else if (ndwi > 0.3) { r=0.0; g=0.3; b=0.85; }
    else if (ndwi > 0.1) { r=0.0; g=0.6; b=0.9; }
    else if (ndwi > 0.0) { r=0.5; g=0.85; b=1.0; }
    else if (ndwi > -0.1) { r=0.9; g=0.9; b=0.7; }
    else if (ndwi > -0.3) { r=0.8; g=0.7; b=0.35; }
    else { r=0.6; g=0.5; b=0.2; }
    return [r, g, b, s.dataMask];
}`,
    },

    // Sentinel-1 evalscripts
    S1Evalscripts: {
        VV: `//VERSION=3
function setup() {
    return {
        input: ["VV", "dataMask"],
        output: { bands: 4 }
    };
}
function evaluatePixel(s) {
    let val = Math.sqrt(s.VV);
    return [val, val, val, s.dataMask];
}`,
        VH: `//VERSION=3
function setup() {
    return {
        input: ["VH", "dataMask"],
        output: { bands: 4 }
    };
}
function evaluatePixel(s) {
    let val = Math.sqrt(s.VH);
    return [val, val, val, s.dataMask];
}`,
        VV_VH: `//VERSION=3
function setup() {
    return {
        input: ["VV", "VH", "dataMask"],
        output: { bands: 4 }
    };
}
function evaluatePixel(s) {
    let r = s.VV;
    let g = s.VH;
    let b = s.VV / (s.VH > 0 ? s.VH : 0.001);
    return [3*r, 8*g, 0.5*b, s.dataMask];
}`,
        CHANGE_DETECTION: `//VERSION=3
function setup() {
    return {
        input: [{
            bands: ["VV", "dataMask"],
            units: "dB"
        }],
        output: { bands: 4 },
        mosaicking: "ORBIT"
    };
}
function preProcessScenes(collections) {
    collections.scenes.orbits = collections.scenes.orbits.filter(function(orbit) {
        var dominated = orbit.dateFrom.getTime();
        return true;
    });
    collections.scenes.orbits.sort(function(a, b) {
        return new Date(b.dateFrom) - new Date(a.dateFrom);
    });
    return collections;
}
function evaluatePixel(samples, scenes) {
    if (samples.length < 2) return [0, 0, 0, 0];
    let after = samples[0];
    let before = samples[1];
    let diff = after.VV - before.VV;
    let threshold = THRESHOLD_DB;
    let r = 0, g = 0, b = 0;
    if (diff > threshold) { r = 1; g = 0; b = 0; }
    else if (diff < -threshold) { r = 0; g = 0; b = 1; }
    else { let v = (after.VV + 20) / 25; r = v; g = v; b = v; }
    return [r, g, b, after.dataMask * before.dataMask];
}`,
    },

    // Defaults
    Defaults: {
        mapCenter: [20, 0],
        mapZoom: 3,
        sentinelMinZoom: 10,
        firmsDefaultRange: 7,
        maxFirePoints: 50000,
        maxConflictPoints: 5000,
    },

    // Conflict event type colors
    ConflictColors: {
        'Battles': '#ff3333',
        'battles': '#ff3333',
        'Explosions/Remote violence': '#ff6600',
        'explosions': '#ff6600',
        'Violence against civilians': '#cc0066',
        'violence_civilians': '#cc0066',
        'Protests': '#ffcc00',
        'protests': '#ffcc00',
        'Riots': '#ff9900',
        'riots': '#ff9900',
        'Strategic developments': '#9966ff',
        'strategic': '#9966ff',
        'state-based': '#ff3333',
        'non-state': '#ff6600',
        'one-sided': '#cc0066',
    },

    // Pin category icons
    PinCategories: {
        general: { label: 'General', icon: '📌' },
        fire: { label: 'Fire/Burn', icon: '🔥' },
        conflict: { label: 'Conflict', icon: '⚔️' },
        flood: { label: 'Flood/Water', icon: '🌊' },
        urban: { label: 'Urban Change', icon: '🏗️' },
        environment: { label: 'Environmental', icon: '🌿' },
        infrastructure: { label: 'Infrastructure', icon: '🏛️' },
    },
};

// Settings manager (localStorage backed)
FunMap.Settings = {
    _prefix: 'funmap_',

    get(key, defaultVal) {
        try {
            const val = localStorage.getItem(this._prefix + key);
            return val !== null ? JSON.parse(val) : defaultVal;
        } catch {
            return defaultVal;
        }
    },

    set(key, val) {
        try {
            localStorage.setItem(this._prefix + key, JSON.stringify(val));
        } catch (e) {
            console.warn('Failed to save setting:', key, e);
        }
    },

    getApiKey(name) {
        return this.get('api_' + name, '');
    },

    setApiKey(name, val) {
        this.set('api_' + name, val);
    },

    // CDSE token management
    _cdseToken: null,
    _cdseTokenExpiry: 0,

    async getCDSEToken() {
        const now = Date.now();
        if (this._cdseToken && now < this._cdseTokenExpiry - 60000) {
            return this._cdseToken;
        }

        const clientId = this.getApiKey('cdse_client_id');
        const clientSecret = this.getApiKey('cdse_client_secret');
        if (!clientId || !clientSecret) {
            throw new Error('CDSE credentials not configured. Go to Settings > API Keys.');
        }

        const response = await fetch(FunMap.Config.CDSE.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret,
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to authenticate with CDSE. Check your credentials.');
        }

        const data = await response.json();
        this._cdseToken = data.access_token;
        this._cdseTokenExpiry = now + (data.expires_in * 1000);
        return this._cdseToken;
    },
};
