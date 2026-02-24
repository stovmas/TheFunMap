/* ============================================
   THE FUN MAP - Sentinel-2 & Sentinel-1 Integration
   ============================================ */

FunMap.Sentinel = {
    _s2Layer: null,
    _s1Layer: null,
    _compareMode: null,  // null, 's2', 's1'
    _compareMaps: { left: null, right: null },
    _compareLayers: { left: null, right: null },
    _changeLayer: null,
    _changeMode: false,

    init() {
        // S2 layer toggle
        document.getElementById('layer-sentinel2').addEventListener('change', (e) => {
            if (e.target.checked) {
                this._enableS2();
            } else {
                this._disableS2();
            }
            FunMap.Map.updateLayerCount();
            FunMap.Map._checkZoomLayers();
            FunMap.UI.updateLegend();
        });

        // S1 layer toggle
        document.getElementById('layer-sentinel1').addEventListener('change', (e) => {
            if (e.target.checked) {
                this._enableS1();
            } else {
                this._disableS1();
            }
            FunMap.Map.updateLayerCount();
            FunMap.Map._checkZoomLayers();
            FunMap.UI.updateLegend();
        });

        // S2 visualization change
        document.getElementById('s2-visualization').addEventListener('change', () => {
            if (document.getElementById('layer-sentinel2').checked) {
                this._refreshS2();
            }
        });

        // S2 cloud cover
        const cloudSlider = document.getElementById('s2-cloud');
        const cloudVal = document.getElementById('s2-cloud-val');
        cloudSlider.addEventListener('input', () => {
            cloudVal.textContent = cloudSlider.value + '%';
        });
        cloudSlider.addEventListener('change', () => {
            if (document.getElementById('layer-sentinel2').checked) {
                this._refreshS2();
            }
        });

        // S1 polarization change
        document.getElementById('s1-polarization').addEventListener('change', () => {
            if (document.getElementById('layer-sentinel1').checked) {
                this._refreshS1();
            }
        });

        // Compare buttons
        document.getElementById('btn-s2-compare').addEventListener('click', () => {
            this._openCompare('s2');
        });
        document.getElementById('btn-s1-compare').addEventListener('click', () => {
            this._openCompare('s1');
        });
        document.getElementById('btn-close-compare').addEventListener('click', () => {
            this._closeCompare();
        });

        // Change detection
        document.getElementById('btn-s1-change').addEventListener('click', () => {
            this._openChangeDetection();
        });
        document.getElementById('btn-close-change').addEventListener('click', () => {
            this._closeChangeDetection();
        });
        document.getElementById('btn-run-change').addEventListener('click', () => {
            this._runChangeDetection();
        });

        // Change threshold display
        const threshSlider = document.getElementById('change-threshold');
        const threshVal = document.getElementById('change-threshold-val');
        threshSlider.addEventListener('input', () => {
            threshVal.textContent = threshSlider.value + ' dB';
        });
    },

    onViewChange() {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);

        if (zoom >= minZoom) {
            if (document.getElementById('layer-sentinel2').checked && this._s2Layer) {
                this._refreshS2();
            }
            if (document.getElementById('layer-sentinel1').checked && this._s1Layer) {
                this._refreshS1();
            }
        }
    },

    // ---- Sentinel-2 ----

    _enableS2() {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        if (zoom < minZoom) {
            FunMap.Utils.toast(`Zoom in to level ${minZoom}+ to see Sentinel-2 data`, 'info');
            return;
        }
        this._refreshS2();
    },

    _disableS2() {
        if (this._s2Layer) {
            FunMap.Map.map.removeLayer(this._s2Layer);
            this._s2Layer = null;
        }
    },

    async _refreshS2() {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        if (zoom < minZoom) return;

        try {
            const token = await FunMap.Settings.getCDSEToken();
            const viz = document.getElementById('s2-visualization').value;
            const cloud = document.getElementById('s2-cloud').value;
            const bounds = FunMap.Map.getBounds();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);
            const dates = FunMap.UI.getDateRange();

            const evalscript = FunMap.Config.S2Evalscripts[viz];
            if (!evalscript) return;

            // Remove old layer
            if (this._s2Layer) {
                FunMap.Map.map.removeLayer(this._s2Layer);
            }

            // Use the process API to get an image
            const mapSize = FunMap.Map.map.getSize();
            const width = Math.min(mapSize.x, 2048);
            const height = Math.min(mapSize.y, 2048);

            const requestBody = {
                input: {
                    bounds: {
                        bbox: bbox,
                        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
                    },
                    data: [{
                        type: 'sentinel-2-l2a',
                        dataFilter: {
                            timeRange: {
                                from: dates.from + 'T00:00:00Z',
                                to: dates.to + 'T23:59:59Z',
                            },
                            maxCloudCoverage: parseInt(cloud),
                            mosaickingOrder: 'leastCC',
                        },
                    }],
                },
                output: {
                    width: width,
                    height: height,
                    responses: [{ identifier: 'default', format: { type: 'image/png' } }],
                },
                evalscript: evalscript,
            };

            FunMap.Utils.setStatus('LOADING SENTINEL-2...');

            const response = await fetch(FunMap.Config.CDSE.processEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'image/png',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Sentinel-2 request failed: ${response.status} - ${errText.substring(0, 200)}`);
            }

            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);

            this._s2Layer = L.imageOverlay(imageUrl, bounds, {
                opacity: 0.9,
                interactive: false,
            });
            this._s2Layer.addTo(FunMap.Map.map);

            FunMap.Utils.setStatus('SENTINEL-2 LOADED');
        } catch (err) {
            console.error('Sentinel-2 error:', err);
            if (err.message.includes('credentials not configured')) {
                FunMap.Utils.toast('Configure CDSE API keys in Settings to load Sentinel-2 data', 'warning');
            } else {
                FunMap.Utils.toast('Sentinel-2: ' + err.message, 'error');
            }
            FunMap.Utils.setStatus('SENTINEL-2 ERROR');
        }
    },

    // ---- Sentinel-1 ----

    _enableS1() {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        if (zoom < minZoom) {
            FunMap.Utils.toast(`Zoom in to level ${minZoom}+ to see Sentinel-1 data`, 'info');
            return;
        }
        this._refreshS1();
    },

    _disableS1() {
        if (this._s1Layer) {
            FunMap.Map.map.removeLayer(this._s1Layer);
            this._s1Layer = null;
        }
    },

    async _refreshS1() {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        if (zoom < minZoom) return;

        try {
            const token = await FunMap.Settings.getCDSEToken();
            const pol = document.getElementById('s1-polarization').value;
            const bounds = FunMap.Map.getBounds();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);
            const dates = FunMap.UI.getDateRange();

            const evalscript = FunMap.Config.S1Evalscripts[pol];
            if (!evalscript) return;

            if (this._s1Layer) {
                FunMap.Map.map.removeLayer(this._s1Layer);
            }

            const mapSize = FunMap.Map.map.getSize();
            const width = Math.min(mapSize.x, 2048);
            const height = Math.min(mapSize.y, 2048);

            const requestBody = {
                input: {
                    bounds: {
                        bbox: bbox,
                        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
                    },
                    data: [{
                        type: 'sentinel-1-grd',
                        dataFilter: {
                            timeRange: {
                                from: dates.from + 'T00:00:00Z',
                                to: dates.to + 'T23:59:59Z',
                            },
                            mosaickingOrder: 'mostRecent',
                        },
                        processing: {
                            backCoeff: 'GAMMA0_TERRAIN',
                            orthorectify: true,
                        },
                    }],
                },
                output: {
                    width: width,
                    height: height,
                    responses: [{ identifier: 'default', format: { type: 'image/png' } }],
                },
                evalscript: evalscript,
            };

            FunMap.Utils.setStatus('LOADING SENTINEL-1...');

            const response = await fetch(FunMap.Config.CDSE.processEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'image/png',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Sentinel-1 request failed: ${response.status} - ${errText.substring(0, 200)}`);
            }

            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);

            this._s1Layer = L.imageOverlay(imageUrl, bounds, {
                opacity: 0.9,
                interactive: false,
            });
            this._s1Layer.addTo(FunMap.Map.map);

            FunMap.Utils.setStatus('SENTINEL-1 LOADED');
        } catch (err) {
            console.error('Sentinel-1 error:', err);
            if (err.message.includes('credentials not configured')) {
                FunMap.Utils.toast('Configure CDSE API keys in Settings to load Sentinel-1 data', 'warning');
            } else {
                FunMap.Utils.toast('Sentinel-1: ' + err.message, 'error');
            }
            FunMap.Utils.setStatus('SENTINEL-1 ERROR');
        }
    },

    // ---- Compare Mode ----

    _openCompare(sensor) {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        if (zoom < minZoom) {
            FunMap.Utils.toast(`Zoom in to level ${minZoom}+ to use comparison`, 'info');
            return;
        }

        const clientId = FunMap.Settings.getApiKey('cdse_client_id');
        if (!clientId) {
            FunMap.Utils.toast('Configure CDSE API keys in Settings first', 'warning');
            return;
        }

        this._compareMode = sensor;
        const container = document.getElementById('compare-container');
        const toolbar = document.getElementById('compare-toolbar');
        const mainMap = document.getElementById('map');

        // Setup visualization selects
        const leftViz = document.getElementById('compare-viz-left');
        const rightViz = document.getElementById('compare-viz-right');
        leftViz.innerHTML = '';
        rightViz.innerHTML = '';

        if (sensor === 's2') {
            const vizOptions = [
                { value: 'TRUE_COLOR', label: 'True Color RGB' },
                { value: 'FALSE_COLOR', label: 'False Color' },
                { value: 'NDVI', label: 'NDVI' },
                { value: 'NDWI', label: 'NDWI' },
            ];
            vizOptions.forEach(opt => {
                leftViz.add(new Option(opt.label, opt.value));
                rightViz.add(new Option(opt.label, opt.value));
            });
        } else {
            const polOptions = [
                { value: 'VV', label: 'VV' },
                { value: 'VH', label: 'VH' },
                { value: 'VV_VH', label: 'VV/VH Ratio' },
            ];
            polOptions.forEach(opt => {
                leftViz.add(new Option(opt.label, opt.value));
                rightViz.add(new Option(opt.label, opt.value));
            });
        }

        // Set default dates
        const dates = FunMap.UI.getDateRange();
        document.getElementById('compare-date-left').value = FunMap.Utils.daysAgo(30);
        document.getElementById('compare-date-right').value = dates.to;

        // Hide main map, show compare
        mainMap.style.display = 'none';
        container.classList.remove('hidden');
        toolbar.classList.remove('hidden');

        // Create side by side maps
        const center = FunMap.Map.getCenter();
        const currentZoom = FunMap.Map.getZoom();

        this._compareMaps.left = L.map('compare-map-left', {
            center: center,
            zoom: currentZoom,
            zoomControl: false,
        });
        this._compareMaps.right = L.map('compare-map-right', {
            center: center,
            zoom: currentZoom,
            zoomControl: false,
        });

        // Add base layers
        const baseCfg = FunMap.Config.BaseMaps[FunMap.Map.currentBase];
        L.tileLayer(baseCfg.url, { attribution: baseCfg.attribution }).addTo(this._compareMaps.left);
        L.tileLayer(baseCfg.url, { attribution: baseCfg.attribution }).addTo(this._compareMaps.right);

        // Sync maps
        this._compareMaps.left.on('move', () => {
            if (this._syncLock) return;
            this._syncLock = true;
            this._compareMaps.right.setView(this._compareMaps.left.getCenter(), this._compareMaps.left.getZoom(), { animate: false });
            this._syncLock = false;
        });
        this._compareMaps.right.on('move', () => {
            if (this._syncLock) return;
            this._syncLock = true;
            this._compareMaps.left.setView(this._compareMaps.right.getCenter(), this._compareMaps.right.getZoom(), { animate: false });
            this._syncLock = false;
        });

        // Load compare imagery
        this._loadCompareImage('left');
        this._loadCompareImage('right');

        // Wire up controls for reloading (use named handlers so we can remove them)
        this._compareHandlers = {
            dateLeft: () => this._loadCompareImage('left'),
            dateRight: () => this._loadCompareImage('right'),
            vizLeft: () => this._loadCompareImage('left'),
            vizRight: () => this._loadCompareImage('right'),
        };
        document.getElementById('compare-date-left').addEventListener('change', this._compareHandlers.dateLeft);
        document.getElementById('compare-date-right').addEventListener('change', this._compareHandlers.dateRight);
        leftViz.addEventListener('change', this._compareHandlers.vizLeft);
        rightViz.addEventListener('change', this._compareHandlers.vizRight);

        FunMap.Utils.setStatus('COMPARE MODE ACTIVE');
    },

    async _loadCompareImage(side) {
        if (!this._compareMode) return;

        try {
            const token = await FunMap.Settings.getCDSEToken();
            const dateInput = document.getElementById(`compare-date-${side}`);
            const vizSelect = document.getElementById(`compare-viz-${side}`);
            const dateVal = dateInput.value;
            const vizVal = vizSelect.value;

            if (!dateVal) return;

            const map = this._compareMaps[side];
            const bounds = map.getBounds();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);
            const mapSize = map.getSize();
            const width = Math.min(mapSize.x, 2048);
            const height = Math.min(mapSize.y, 2048);

            let evalscript, dataType, dataConfig;
            if (this._compareMode === 's2') {
                evalscript = FunMap.Config.S2Evalscripts[vizVal];
                dataType = 'sentinel-2-l2a';
                dataConfig = {
                    type: dataType,
                    dataFilter: {
                        timeRange: {
                            from: dateVal + 'T00:00:00Z',
                            to: dateVal + 'T23:59:59Z',
                        },
                        maxCloudCoverage: parseInt(document.getElementById('s2-cloud').value),
                        mosaickingOrder: 'leastCC',
                    },
                };
            } else {
                evalscript = FunMap.Config.S1Evalscripts[vizVal];
                dataType = 'sentinel-1-grd';
                dataConfig = {
                    type: dataType,
                    dataFilter: {
                        timeRange: {
                            from: dateVal + 'T00:00:00Z',
                            to: dateVal + 'T23:59:59Z',
                        },
                        mosaickingOrder: 'mostRecent',
                    },
                    processing: {
                        backCoeff: 'GAMMA0_TERRAIN',
                        orthorectify: true,
                    },
                };
            }

            // Widen time range to +/- 15 days for better mosaic
            const fromDate = new Date(dateVal);
            fromDate.setDate(fromDate.getDate() - 15);
            const toDate = new Date(dateVal);
            toDate.setDate(toDate.getDate() + 15);
            dataConfig.dataFilter.timeRange = {
                from: FunMap.Utils.toISODate(fromDate) + 'T00:00:00Z',
                to: FunMap.Utils.toISODate(toDate) + 'T23:59:59Z',
            };

            const requestBody = {
                input: {
                    bounds: {
                        bbox: bbox,
                        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
                    },
                    data: [dataConfig],
                },
                output: {
                    width: width,
                    height: height,
                    responses: [{ identifier: 'default', format: { type: 'image/png' } }],
                },
                evalscript: evalscript,
            };

            const response = await fetch(FunMap.Config.CDSE.processEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'image/png',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) throw new Error(`Compare image failed: ${response.status}`);

            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);

            if (this._compareLayers[side]) {
                map.removeLayer(this._compareLayers[side]);
            }

            this._compareLayers[side] = L.imageOverlay(imageUrl, bounds, {
                opacity: 0.9,
            });
            this._compareLayers[side].addTo(map);

        } catch (err) {
            console.error(`Compare ${side} error:`, err);
            FunMap.Utils.toast(`Compare ${side}: ${err.message}`, 'error');
        }
    },

    _closeCompare() {
        // Remove event listeners
        if (this._compareHandlers) {
            document.getElementById('compare-date-left').removeEventListener('change', this._compareHandlers.dateLeft);
            document.getElementById('compare-date-right').removeEventListener('change', this._compareHandlers.dateRight);
            document.getElementById('compare-viz-left').removeEventListener('change', this._compareHandlers.vizLeft);
            document.getElementById('compare-viz-right').removeEventListener('change', this._compareHandlers.vizRight);
            this._compareHandlers = null;
        }

        // Destroy compare maps
        if (this._compareMaps.left) {
            this._compareMaps.left.remove();
            this._compareMaps.left = null;
        }
        if (this._compareMaps.right) {
            this._compareMaps.right.remove();
            this._compareMaps.right = null;
        }
        this._compareLayers = { left: null, right: null };
        this._compareMode = null;

        // Clear map containers for reinit
        document.getElementById('compare-map-left').innerHTML = '';
        document.getElementById('compare-map-right').innerHTML = '';

        // Show main map, hide compare
        document.getElementById('map').style.display = '';
        document.getElementById('compare-container').classList.add('hidden');
        document.getElementById('compare-toolbar').classList.add('hidden');

        // Force main map to recalculate size
        FunMap.Map.map.invalidateSize();
        FunMap.Utils.setStatus('SYSTEMS ONLINE');
    },

    // ---- Change Detection ----

    _openChangeDetection() {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        if (zoom < minZoom) {
            FunMap.Utils.toast(`Zoom in to level ${minZoom}+ to use change detection`, 'info');
            return;
        }

        const clientId = FunMap.Settings.getApiKey('cdse_client_id');
        if (!clientId) {
            FunMap.Utils.toast('Configure CDSE API keys in Settings first', 'warning');
            return;
        }

        this._changeMode = true;
        document.getElementById('change-toolbar').classList.remove('hidden');

        // Set default dates
        document.getElementById('change-date-a').value = FunMap.Utils.daysAgo(30);
        document.getElementById('change-date-b').value = FunMap.Utils.daysAgo(0);

        FunMap.Utils.setStatus('CHANGE DETECTION MODE');
    },

    _closeChangeDetection() {
        this._changeMode = false;
        document.getElementById('change-toolbar').classList.add('hidden');

        if (this._changeLayer) {
            FunMap.Map.map.removeLayer(this._changeLayer);
            this._changeLayer = null;
        }
        FunMap.Utils.setStatus('SYSTEMS ONLINE');
    },

    async _runChangeDetection() {
        try {
            const token = await FunMap.Settings.getCDSEToken();
            const dateA = document.getElementById('change-date-a').value;
            const dateB = document.getElementById('change-date-b').value;
            const threshold = parseFloat(document.getElementById('change-threshold').value);

            if (!dateA || !dateB) {
                FunMap.Utils.toast('Please select both dates', 'warning');
                return;
            }

            FunMap.Utils.showLoading('COMPUTING CHANGE DETECTION...');

            const bounds = FunMap.Map.getBounds();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);
            const mapSize = FunMap.Map.map.getSize();
            const width = Math.min(mapSize.x, 2048);
            const height = Math.min(mapSize.y, 2048);

            // Custom evalscript for change detection with the threshold
            const evalscript = `//VERSION=3
function setup() {
    return {
        input: [{
            bands: ["VV", "dataMask"],
            units: "DB"
        }],
        output: { bands: 4 },
        mosaicking: "ORBIT"
    };
}
function preProcessScenes(collections) {
    collections.scenes.orbits.sort(function(a, b) {
        return new Date(a.dateFrom) - new Date(b.dateFrom);
    });
    return collections;
}
function evaluatePixel(samples, scenes) {
    if (samples.length < 2) return [0.5, 0.5, 0.5, 0];
    let before = samples[0];
    let after = samples[samples.length - 1];
    let diff = after.VV - before.VV;
    let threshold = ${threshold};
    let r = 0, g = 0, b = 0, a = 1;
    if (diff > threshold) {
        let intensity = Math.min(1, (diff - threshold) / 5);
        r = 1; g = 0.2 * (1 - intensity); b = 0;
    } else if (diff < -threshold) {
        let intensity = Math.min(1, (-diff - threshold) / 5);
        r = 0; g = 0.2 * (1 - intensity); b = 1;
    } else {
        let v = (after.VV + 20) / 25;
        r = v * 0.7; g = v * 0.7; b = v * 0.7;
    }
    return [r, g, b, after.dataMask * before.dataMask];
}`;

            const requestBody = {
                input: {
                    bounds: {
                        bbox: bbox,
                        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
                    },
                    data: [{
                        type: 'sentinel-1-grd',
                        dataFilter: {
                            timeRange: {
                                from: dateA + 'T00:00:00Z',
                                to: dateB + 'T23:59:59Z',
                            },
                            mosaickingOrder: 'mostRecent',
                        },
                        processing: {
                            backCoeff: 'GAMMA0_TERRAIN',
                            orthorectify: true,
                        },
                    }],
                },
                output: {
                    width: width,
                    height: height,
                    responses: [{ identifier: 'default', format: { type: 'image/png' } }],
                },
                evalscript: evalscript,
            };

            const response = await fetch(FunMap.Config.CDSE.processEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'image/png',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Change detection failed: ${response.status} - ${errText.substring(0, 200)}`);
            }

            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);

            if (this._changeLayer) {
                FunMap.Map.map.removeLayer(this._changeLayer);
            }

            this._changeLayer = L.imageOverlay(imageUrl, bounds, {
                opacity: 0.85,
            });
            this._changeLayer.addTo(FunMap.Map.map);

            FunMap.Utils.hideLoading();
            FunMap.Utils.setStatus('CHANGE DETECTION COMPLETE');
            FunMap.Utils.toast('Change detection complete. Red = increase, Blue = decrease.', 'success');

        } catch (err) {
            FunMap.Utils.hideLoading();
            console.error('Change detection error:', err);
            FunMap.Utils.toast('Change detection: ' + err.message, 'error');
            FunMap.Utils.setStatus('CHANGE DETECTION ERROR');
        }
    },
};
