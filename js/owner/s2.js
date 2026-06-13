/* ============================================
   OWNER REPORT - Sentinel-2 data access (CDSE)
   - Statistical API: cloud-masked NDVI/NDRE
     zonal stats per acquisition date
   - Process API: FLOAT32 NDVI rasters (GeoTIFF)
   - Process API: rendered PNG for report hero
   Pure fetch layer: no DOM, portable to Node.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.S2 = {
    _geometry(ring) {
        return {
            type: 'Polygon',
            coordinates: [FunMap.Owner.Geometry.closeRing(ring)],
        };
    },

    /**
     * Zonal stats over a polygon for a date range.
     * Returns rows: { date, ndviMean, ndviMedian, ndviP10, ndviP90,
     *                 ndviStd, ndreMean, validFraction }
     * Only rows meeting nothing — caller applies the validity rule.
     */
    async fetchTimeseries(ring, fromDate, toDate) {
        const C = FunMap.Owner.Config;
        const token = await FunMap.Settings.getCDSEToken();

        const body = {
            input: {
                bounds: {
                    geometry: this._geometry(ring),
                    properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
                },
                data: [{ type: 'sentinel-2-l2a', dataFilter: {} }],
            },
            aggregation: {
                timeRange: { from: fromDate + 'T00:00:00Z', to: toDate + 'T23:59:59Z' },
                aggregationInterval: { of: 'P1D' },
                resx: C.rasterResDeg,
                resy: C.rasterResDeg,
                evalscript: C.STATS_EVALSCRIPT,
            },
            calculations: {
                default: { statistics: { default: { percentiles: { k: [10, 50, 90] } } } },
            },
        };

        const resp = await fetch(C.statsEndpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(`Statistical API ${resp.status}: ${t.substring(0, 160)}`);
        }
        const data = await resp.json();
        return this._parseStats(data);
    },

    _parseStats(data) {
        const rows = [];
        (data.data || []).forEach(item => {
            try {
                const ndvi = item.outputs.ndvi.bands.B0.stats;
                const ndre = item.outputs.ndre && item.outputs.ndre.bands.B0.stats;
                const total = ndvi.sampleCount || 0;
                const noData = ndvi.noDataCount || 0;
                const valid = total - noData;
                if (total === 0 || valid <= 0) return;
                const pct = this._percentiles(ndvi);
                rows.push({
                    date: item.interval.from.split('T')[0],
                    ndviMean: ndvi.mean,
                    ndviMedian: pct[50] !== undefined ? pct[50] : ndvi.mean,
                    ndviP10: pct[10],
                    ndviP90: pct[90],
                    ndviStd: ndvi.stDev,
                    ndreMean: ndre ? ndre.mean : null,
                    validFraction: valid / total,
                });
            } catch (e) { /* skip malformed interval */ }
        });
        rows.sort((a, b) => a.date.localeCompare(b.date));
        return rows;
    },

    _percentiles(stats) {
        const out = {};
        const p = stats.percentiles || {};
        Object.keys(p).forEach(k => { out[Math.round(parseFloat(k))] = p[k]; });
        return out;
    },

    /**
     * FLOAT32 NDVI raster for one date over a bbox.
     * Returns { width, height, bbox, data: Float32Array } (NaN = masked).
     */
    async fetchNdviRaster(bbox, dateStr, width, height) {
        const C = FunMap.Owner.Config;
        const token = await FunMap.Settings.getCDSEToken();

        const resp = await fetch(FunMap.Config.CDSE.processEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'image/tiff',
            },
            body: JSON.stringify({
                input: {
                    bounds: { bbox: bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
                    data: [{
                        type: 'sentinel-2-l2a',
                        dataFilter: {
                            timeRange: { from: dateStr + 'T00:00:00Z', to: dateStr + 'T23:59:59Z' },
                            maxCloudCoverage: 100,
                            mosaickingOrder: 'leastCC',
                        },
                    }],
                },
                output: {
                    width: width, height: height,
                    responses: [{ identifier: 'default', format: { type: 'image/tiff' } }],
                },
                evalscript: C.RASTER_EVALSCRIPT,
            }),
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(`Raster fetch ${resp.status}: ${t.substring(0, 160)}`);
        }

        const buf = await resp.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(buf);
        const image = await tiff.getImage();
        const rasters = await image.readRasters();
        return {
            width: image.getWidth(),
            height: image.getHeight(),
            bbox: bbox,
            data: rasters[0], // Float32Array, NaN where masked
        };
    },

    /** Rendered PNG over a bbox (hero / overlay base). Returns Blob. */
    async fetchRenderPng(bbox, dateStr, width, height, evalscript) {
        const token = await FunMap.Settings.getCDSEToken();
        const resp = await fetch(FunMap.Config.CDSE.processEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'image/png',
            },
            body: JSON.stringify({
                input: {
                    bounds: { bbox: bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
                    data: [{
                        type: 'sentinel-2-l2a',
                        dataFilter: {
                            timeRange: { from: dateStr + 'T00:00:00Z', to: dateStr + 'T23:59:59Z' },
                            maxCloudCoverage: 100,
                            mosaickingOrder: 'leastCC',
                        },
                        processing: { upsampling: 'BILINEAR', downsampling: 'BILINEAR' },
                    }],
                },
                output: {
                    width: width, height: height,
                    responses: [{ identifier: 'default', format: { type: 'image/png' } }],
                },
                evalscript: evalscript || FunMap.Owner.Config.HERO_EVALSCRIPT,
            }),
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(`Render fetch ${resp.status}: ${t.substring(0, 160)}`);
        }
        return resp.blob();
    },
};
