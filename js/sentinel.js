/* ============================================
   THE FUN MAP - Sentinel-2 & Sentinel-1 Integration
   ============================================ */

FunMap.Sentinel = {
    _s2Layer: null,
    _s2Url: null,            // ObjectURL for current S2 image (revoked on swap)
    _s2AbortCtrl: null,      // AbortController for in-flight S2 fetch
    _s2LoadGen: 0,           // generation counter to discard stale S2 responses
    _s1Layer: null,
    _s1Url: null,            // ObjectURL for current S1 image (revoked on swap)
    _s1AbortCtrl: null,      // AbortController for in-flight S1 fetch
    _s1LoadGen: 0,           // generation counter to discard stale S1 responses
    _compareMode: null,  // null, 's2', 's1'
    _compareMaps: { left: null, right: null },
    _compareLayers: { left: null, right: null },
    _compareAbortCtrl: { left: null, right: null }, // AbortControllers for compare fetches
    _cvaLayer: null,       // CVA overlay layer on compare map
    _cvaUrl: null,         // ObjectURL for CVA image
    _cvaAbortCtrl: null,   // AbortController for CVA fetch
    _cvaActive: false,     // Whether CVA overlay is visible
    _changeLayer: null,
    _changeMode: false,
    _fetchGeneration: {},  // keyed by calendar group, cancels stale fetches
    _dateCloudCache: {},   // keyed by calendar group, stores { allDates, cloudMap, collectionId, calendarInputIds }

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
            this._refilterDates();
            if (document.getElementById('layer-sentinel2').checked) {
                this._refreshS2();
            }
        });

        // S2 spatial smoothing toggle — re-fetch with server-side resampling
        document.getElementById('s2-smooth').addEventListener('change', () => {
            if (document.getElementById('layer-sentinel2').checked) {
                this._refreshS2();
            }
            if (this._compareMode === 's2') {
                this._loadCompareImage('left');
                this._loadCompareImage('right');
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
        this.refreshS2AvailableDates();
    },

    _disableS2() {
        if (this._s2AbortCtrl) { this._s2AbortCtrl.abort(); this._s2AbortCtrl = null; }
        if (this._s2Layer) {
            FunMap.Map.map.removeLayer(this._s2Layer);
            this._s2Layer = null;
        }
        if (this._s2Url) { URL.revokeObjectURL(this._s2Url); this._s2Url = null; }
    },

    async _refreshS2() {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        if (zoom < minZoom) return;

        // Generation counter — discard responses from older requests
        const gen = ++this._s2LoadGen;

        // Abort any in-flight request so it doesn't waste bandwidth
        if (this._s2AbortCtrl) this._s2AbortCtrl.abort();
        const abortCtrl = new AbortController();
        this._s2AbortCtrl = abortCtrl;

        try {
            const token = await FunMap.Settings.getCDSEToken();
            if (this._s2LoadGen !== gen) return; // superseded

            const viz = document.getElementById('s2-visualization').value;
            const cloud = document.getElementById('s2-cloud').value;
            const bounds = FunMap.Map.getBounds();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);
            const dateVal = document.getElementById('s2-date').value;
            if (!dateVal) return;

            const evalscript = FunMap.Config.S2Evalscripts[viz];
            if (!evalscript) return;

            const mapSize = FunMap.Map.map.getSize();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = Math.min(Math.round(mapSize.x * dpr), 2500);
            const height = Math.min(Math.round(mapSize.y * dpr), 2500);

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
                                from: dateVal + 'T00:00:00Z',
                                to: dateVal + 'T23:59:59Z',
                            },
                            maxCloudCoverage: parseInt(cloud),
                            mosaickingOrder: 'mostRecent',
                        },
                        processing: {
                            upsampling: document.getElementById('s2-smooth').checked ? 'BILINEAR' : 'NEAREST',
                            downsampling: document.getElementById('s2-smooth').checked ? 'BILINEAR' : 'NEAREST',
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
                signal: abortCtrl.signal,
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Sentinel-2 request failed: ${response.status} - ${errText.substring(0, 200)}`);
            }

            const blob = await response.blob();

            // Discard if a newer request has superseded this one
            if (this._s2LoadGen !== gen) return;

            const imageUrl = URL.createObjectURL(blob);
            const oldLayer = this._s2Layer;
            const oldUrl = this._s2Url;

            const newLayer = L.imageOverlay(imageUrl, bounds, {
                opacity: 0.9,
                interactive: false,
            });
            newLayer.addTo(FunMap.Map.map);

            // Keep old layer visible until new image has rendered
            newLayer.on('load', () => {
                if (oldLayer) FunMap.Map.map.removeLayer(oldLayer);
                if (oldUrl) URL.revokeObjectURL(oldUrl);
            });

            this._s2Layer = newLayer;
            this._s2Url = imageUrl;
            this._s2AbortCtrl = null;

            FunMap.Utils.setStatus(`SENTINEL-2 LOADED | ${dateVal}`);
        } catch (err) {
            if (err.name === 'AbortError') return; // intentionally cancelled
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
        this.refreshS1AvailableDates();
    },

    _disableS1() {
        if (this._s1AbortCtrl) { this._s1AbortCtrl.abort(); this._s1AbortCtrl = null; }
        if (this._s1Layer) {
            FunMap.Map.map.removeLayer(this._s1Layer);
            this._s1Layer = null;
        }
        if (this._s1Url) { URL.revokeObjectURL(this._s1Url); this._s1Url = null; }
    },

    async _refreshS1() {
        const zoom = FunMap.Map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        if (zoom < minZoom) return;

        // Generation counter — discard responses from older requests
        const gen = ++this._s1LoadGen;

        // Abort any in-flight request so it doesn't waste bandwidth
        if (this._s1AbortCtrl) this._s1AbortCtrl.abort();
        const abortCtrl = new AbortController();
        this._s1AbortCtrl = abortCtrl;

        try {
            const token = await FunMap.Settings.getCDSEToken();
            if (this._s1LoadGen !== gen) return; // superseded

            const pol = document.getElementById('s1-polarization').value;
            const bounds = FunMap.Map.getBounds();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);
            const dateVal = document.getElementById('s1-date').value;
            if (!dateVal) return;

            const evalscript = FunMap.Config.S1Evalscripts[pol];
            if (!evalscript) return;

            const mapSize = FunMap.Map.map.getSize();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = Math.min(Math.round(mapSize.x * dpr), 2500);
            const height = Math.min(Math.round(mapSize.y * dpr), 2500);

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
                                from: dateVal + 'T00:00:00Z',
                                to: dateVal + 'T23:59:59Z',
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
                signal: abortCtrl.signal,
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Sentinel-1 request failed: ${response.status} - ${errText.substring(0, 200)}`);
            }

            const blob = await response.blob();

            // Discard if a newer request has superseded this one
            if (this._s1LoadGen !== gen) return;

            const imageUrl = URL.createObjectURL(blob);
            const oldLayer = this._s1Layer;
            const oldUrl = this._s1Url;

            const newLayer = L.imageOverlay(imageUrl, bounds, {
                opacity: 0.9,
                interactive: false,
            });
            newLayer.addTo(FunMap.Map.map);

            // Keep old layer visible until new image has rendered
            newLayer.on('load', () => {
                if (oldLayer) FunMap.Map.map.removeLayer(oldLayer);
                if (oldUrl) URL.revokeObjectURL(oldUrl);
            });

            this._s1Layer = newLayer;
            this._s1Url = imageUrl;
            this._s1AbortCtrl = null;

            FunMap.Utils.setStatus(`SENTINEL-1 LOADED | ${dateVal}`);
        } catch (err) {
            if (err.name === 'AbortError') return; // intentionally cancelled
            console.error('Sentinel-1 error:', err);
            if (err.message.includes('credentials not configured')) {
                FunMap.Utils.toast('Configure CDSE API keys in Settings to load Sentinel-1 data', 'warning');
            } else {
                FunMap.Utils.toast('Sentinel-1: ' + err.message, 'error');
            }
            FunMap.Utils.setStatus('SENTINEL-1 ERROR');
        }
    },

    // ---- Compare Mode (Slider-based) ----

    _compareMap: null,
    _sliderPos: 0.5, // 0-1 position
    _compareImageCache: { left: null, right: null },
    _compareBounds: null, // locked bounds for both sides
    _compareLoadGen: { left: 0, right: 0 }, // generation counter per side

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
        this._sliderPos = 0.5;
        this._compareImageCache = { left: null, right: null };
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

        // Attach calendars to compare date inputs
        const compareCalOpts = {
            onOpen: () => this._fetchAvailableDates(),
        };
        FunMap.Calendar.attach('compare-date-left', compareCalOpts);
        FunMap.Calendar.attach('compare-date-right', compareCalOpts);

        // Set default dates — use the layer's own date picker as the AFTER date
        const layerDate = document.getElementById(sensor === 's2' ? 's2-date' : 's1-date').value
            || FunMap.Utils.toISODate(new Date());
        FunMap.Calendar.setValue('compare-date-left', FunMap.Utils.daysAgo(30));
        FunMap.Calendar.setValue('compare-date-right', layerDate);

        // Hide main map, show compare
        mainMap.style.display = 'none';
        container.classList.remove('hidden');
        toolbar.classList.remove('hidden');

        // Create single map for comparison
        const center = FunMap.Map.getCenter();
        const currentZoom = FunMap.Map.getZoom();

        this._compareMap = L.map('compare-map-single', {
            center: center,
            zoom: currentZoom,
            zoomControl: true,
        });

        // Add base layer
        const baseCfg = FunMap.Config.BaseMaps[FunMap.Map.currentBase];
        L.tileLayer(baseCfg.url, { attribution: baseCfg.attribution }).addTo(this._compareMap);

        // Setup slider
        this._initCompareSlider();

        // Update clip on map move/zoom, and keep status bar in sync
        this._compareMap.on('move zoom viewreset', () => {
            this._updateCompareClip();
        });
        this._compareMap.on('zoomend', () => {
            document.getElementById('zoom-level').textContent =
                Math.round(this._compareMap.getZoom());
        });
        this._compareMap.on('mousemove', FunMap.Utils.throttle((e) => {
            document.getElementById('cursor-coords').textContent =
                FunMap.Utils.formatCoords(e.latlng.lat, e.latlng.lng);
        }, 50));

        // Auto-reload both images on pan/zoom (debounced to avoid API spam)
        this._compareMoveTimer = null;
        this._compareMap.on('moveend', () => {
            clearTimeout(this._compareMoveTimer);
            this._compareMoveTimer = setTimeout(() => {
                this._compareBounds = this._compareMap.getBounds();
                this._loadCompareImage('left');
                this._loadCompareImage('right');
            }, 300);
        });

        // Lock bounds and load both images with same geographic extent
        this._compareBounds = this._compareMap.getBounds();
        this._loadCompareImage('left');
        this._loadCompareImage('right');

        // Fetch available dates for date pickers
        this._fetchAvailableDates();

        // Wire up Apply button - re-lock bounds and reload both
        this._compareHandlers = {
            apply: () => {
                this._compareBounds = this._compareMap.getBounds();
                this._loadCompareImage('left');
                this._loadCompareImage('right');
                this._fetchAvailableDates();
                // Clear CVA when images change
                if (this._cvaActive) this._removeCVA();
                FunMap.Utils.toast('Compare images updating...', 'info');
            },
            cva: () => {
                this._runCVA();
            },
            toggleCva: () => {
                this._toggleCVA();
            },
            downloadCva: () => {
                this._downloadCVA();
            },
        };
        document.getElementById('btn-apply-compare').addEventListener('click', this._compareHandlers.apply);
        document.getElementById('btn-cva-compare').addEventListener('click', this._compareHandlers.cva);
        document.getElementById('btn-toggle-cva').addEventListener('click', this._compareHandlers.toggleCva);
        document.getElementById('btn-download-cva').addEventListener('click', this._compareHandlers.downloadCva);

        FunMap.Utils.setStatus('COMPARE MODE ACTIVE');
    },

    _initCompareSlider() {
        const slider = document.getElementById('compare-slider');
        const container = document.getElementById('compare-container');

        // Position slider at 50%
        this._updateSliderPosition(0.5);

        let dragging = false;

        const onMove = (clientX) => {
            const rect = container.getBoundingClientRect();
            const pos = FunMap.Utils.clamp((clientX - rect.left) / rect.width, 0.02, 0.98);
            this._sliderPos = pos;
            this._updateSliderPosition(pos);
            this._updateCompareClip();
        };

        // Store named handlers so we can remove them on close
        this._sliderHandlers = {
            mouseMove: (e) => { if (dragging) onMove(e.clientX); },
            mouseUp: () => { dragging = false; },
            touchMove: (e) => { if (dragging) onMove(e.touches[0].clientX); },
            touchEnd: () => { dragging = false; },
        };

        // Mouse events
        slider.addEventListener('mousedown', (e) => {
            dragging = true;
            e.preventDefault();
        });
        document.addEventListener('mousemove', this._sliderHandlers.mouseMove);
        document.addEventListener('mouseup', this._sliderHandlers.mouseUp);

        // Touch events
        slider.addEventListener('touchstart', (e) => {
            dragging = true;
            e.preventDefault();
        }, { passive: false });
        document.addEventListener('touchmove', this._sliderHandlers.touchMove);
        document.addEventListener('touchend', this._sliderHandlers.touchEnd);
    },

    _updateSliderPosition(pos) {
        const container = document.getElementById('compare-container');
        const slider = document.getElementById('compare-slider');
        const pxPos = pos * container.offsetWidth;
        slider.style.left = pxPos + 'px';
    },

    _updateCompareClip() {
        // Clip the right (after) image at the slider position
        if (this._compareLayers.right && this._compareLayers.right._image) {
            const img = this._compareLayers.right._image;
            const containerWidth = document.getElementById('compare-container').offsetWidth;
            const sliderPx = this._sliderPos * containerWidth;

            // Convert slider position from container coords to image-element coords
            const mapContainer = document.getElementById('compare-map-single');
            const mapRect = mapContainer.getBoundingClientRect();
            const imgRect = img.getBoundingClientRect();
            const clipLeft = sliderPx - (imgRect.left - mapRect.left);

            img.style.clipPath = `inset(0 0 0 ${clipLeft}px)`;
        }
    },

    // Shared: fetch available image dates from CDSE catalog and highlight on calendars
    // Paginates through all results over the last 2 years.
    // Uses a generation counter so overlapping calls for the same calendar group
    // don't race — only the latest request applies its results.
    async fetchAvailableDatesFor(collectionId, bounds, calendarInputIds, showToast) {
        const fetchKey = calendarInputIds.join(',');
        const generation = (this._fetchGeneration[fetchKey] || 0) + 1;
        this._fetchGeneration[fetchKey] = generation;

        try {
            const token = await FunMap.Settings.getCDSEToken();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);

            const isS2 = collectionId === 'sentinel-2-l2a';
            const from = FunMap.Utils.daysAgo(730); // ~2 years
            const to = FunMap.Utils.toISODate(new Date());
            const dateSet = new Set();
            const cloudMap = {};  // date -> min cloud cover %
            let nextToken = null;
            const maxPages = 10; // safety cap

            const fieldsInclude = ['properties.datetime'];
            if (isS2) fieldsInclude.push('properties.eo:cloud_cover');

            for (let page = 0; page < maxPages; page++) {
                // Abort if a newer fetch has started for this calendar group
                if (this._fetchGeneration[fetchKey] !== generation) return [];

                const searchBody = {
                    bbox: bbox,
                    datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
                    collections: [collectionId],
                    limit: 100,
                    fields: { include: fieldsInclude },
                };
                if (nextToken) searchBody.next = nextToken;

                const response = await fetch(FunMap.Config.CDSE.catalogEndpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(searchBody),
                });

                if (!response.ok) break;

                const data = await response.json();
                if (data.features) {
                    data.features.forEach(f => {
                        if (f.properties && f.properties.datetime) {
                            const date = f.properties.datetime.split('T')[0];
                            dateSet.add(date);
                            // Track minimum cloud cover per date (best tile)
                            const cc = f.properties['eo:cloud_cover'];
                            if (cc !== undefined && cc !== null) {
                                if (!(date in cloudMap) || cc < cloudMap[date]) {
                                    cloudMap[date] = cc;
                                }
                            }
                        }
                    });
                }

                // Check for next page via STAC context
                const ctx = data.context;
                if (ctx && ctx.next) {
                    nextToken = ctx.next;
                } else if (data.links) {
                    const nextLink = data.links.find(l => l.rel === 'next');
                    if (nextLink && nextLink.body && nextLink.body.next) {
                        nextToken = nextLink.body.next;
                    } else {
                        break; // no more pages
                    }
                } else {
                    break; // no more pages
                }

                // Update calendars progressively (only if still the latest request)
                if (this._fetchGeneration[fetchKey] === generation) {
                    const filteredSoFar = this._filterDatesByCloud(Array.from(dateSet), cloudMap, isS2);
                    FunMap.Calendar.setAvailableDatesMulti(calendarInputIds, filteredSoFar);
                }
            }

            // Final update (only if still the latest request)
            if (this._fetchGeneration[fetchKey] !== generation) return [];

            const sortedDates = Array.from(dateSet).sort().reverse();

            // Cache raw results so the cloud slider can re-filter without re-fetching
            this._dateCloudCache[fetchKey] = {
                allDates: sortedDates,
                cloudMap: cloudMap,
                collectionId: collectionId,
                calendarInputIds: calendarInputIds,
            };

            const filteredDates = this._filterDatesByCloud(sortedDates, cloudMap, isS2);

            // Only update calendars if we actually got results — don't wipe
            // existing dates when the API fails (e.g. token expired mid-request)
            if (filteredDates.length > 0) {
                FunMap.Calendar.setAvailableDatesMulti(calendarInputIds, filteredDates);
            }

            if (showToast && sortedDates.length > 0) {
                FunMap.Utils.toast(`${filteredDates.length} of ${sortedDates.length} dates within cloud limit`, 'info');
            }
            return filteredDates;
        } catch (err) {
            console.warn('Could not fetch available dates:', err);
            return [];
        }
    },

    async _fetchAvailableDates() {
        if (!this._compareMode || !this._compareMap) return;
        const collectionId = this._compareMode === 's2' ? 'sentinel-2-l2a' : 'sentinel-1-grd';
        const bounds = this._compareMap.getBounds();
        await this.fetchAvailableDatesFor(collectionId, bounds,
            ['compare-date-left', 'compare-date-right'], true);
    },

    // Fetch available dates for the Sentinel-2 date picker
    async refreshS2AvailableDates() {
        const clientId = FunMap.Settings.getApiKey('cdse_client_id');
        if (!clientId) return;
        const bounds = FunMap.Map.getBounds();
        await this.fetchAvailableDatesFor('sentinel-2-l2a', bounds, ['s2-date'], false);
    },

    // Fetch available dates for the Sentinel-1 date picker
    async refreshS1AvailableDates() {
        const clientId = FunMap.Settings.getApiKey('cdse_client_id');
        if (!clientId) return;
        const bounds = FunMap.Map.getBounds();
        await this.fetchAvailableDatesFor('sentinel-1-grd', bounds, ['s1-date'], false);
    },

    // Fetch available dates for change detection
    async refreshChangeDatesAvailable() {
        const clientId = FunMap.Settings.getApiKey('cdse_client_id');
        if (!clientId) return;

        const bounds = FunMap.Map.getBounds();
        await this.fetchAvailableDatesFor('sentinel-1-grd', bounds,
            ['change-date-a', 'change-date-b'], false);
    },

    // Filter dates by current cloud cover slider value.
    // For S2, only keep dates where at least one tile has cloud cover <= max.
    // For S1 (no cloud data), all dates pass through.
    _filterDatesByCloud(dates, cloudMap, isS2) {
        if (!isS2) return dates;
        const maxCC = parseInt(document.getElementById('s2-cloud').value);
        return dates.filter(d => {
            if (!(d in cloudMap)) return true; // no CC info, include
            return cloudMap[d] <= maxCC;
        });
    },

    // Re-filter all cached calendar groups by the current cloud slider value.
    // Called when the slider changes — instant, no API call.
    _refilterDates() {
        for (const [fetchKey, cache] of Object.entries(this._dateCloudCache)) {
            const isS2 = cache.collectionId === 'sentinel-2-l2a';
            const filtered = this._filterDatesByCloud(cache.allDates, cache.cloudMap, isS2);
            FunMap.Calendar.setAvailableDatesMulti(cache.calendarInputIds, filtered);
        }
    },

    async _loadCompareImage(side) {
        if (!this._compareMode || !this._compareMap) return;

        // Generation counter prevents stale responses from overwriting newer ones
        const gen = ++this._compareLoadGen[side];

        // Abort any in-flight request for this side
        if (this._compareAbortCtrl[side]) this._compareAbortCtrl[side].abort();
        const abortCtrl = new AbortController();
        this._compareAbortCtrl[side] = abortCtrl;

        try {
            const token = await FunMap.Settings.getCDSEToken();
            if (this._compareLoadGen[side] !== gen) return; // superseded

            const dateInput = document.getElementById(`compare-date-${side}`);
            const vizSelect = document.getElementById(`compare-viz-${side}`);
            const dateVal = dateInput.value;
            const vizVal = vizSelect.value;

            if (!dateVal) return;

            const map = this._compareMap;
            // Use locked bounds so both sides have identical geographic extent
            const bounds = this._compareBounds || map.getBounds();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);
            const mapSize = map.getSize();
            // Account for device pixel ratio so images are sharp on high-DPI screens
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = Math.min(Math.round(mapSize.x * dpr), 2500);
            const height = Math.min(Math.round(mapSize.y * dpr), 2500);

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
                        mosaickingOrder: 'mostRecent',
                    },
                    processing: {
                        upsampling: document.getElementById('s2-smooth').checked ? 'BILINEAR' : 'NEAREST',
                        downsampling: document.getElementById('s2-smooth').checked ? 'BILINEAR' : 'NEAREST',
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

            FunMap.Utils.setStatus(`LOADING ${side.toUpperCase()} IMAGE...`);

            // Show per-side loading spinner
            const loadingEl = document.getElementById(`compare-loading-${side}`);
            if (loadingEl) loadingEl.classList.remove('hidden');

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
                signal: abortCtrl.signal,
            });

            if (!response.ok) {
                // On 401/403, force a token refresh and retry once
                if ((response.status === 401 || response.status === 403) && !this._compareRetried) {
                    this._compareRetried = true;
                    FunMap.Settings._cdseToken = null;
                    FunMap.Settings._cdseTokenExpiry = 0;
                    return this._loadCompareImage(side);
                }
                const errText = await response.text().catch(() => '');
                throw new Error(`Compare image failed: ${response.status} - ${errText.substring(0, 200)}`);
            }
            this._compareRetried = false;

            const blob = await response.blob();

            // Discard if a newer request has superseded this one
            if (this._compareLoadGen[side] !== gen) return;

            // Revoke old cached URL
            if (this._compareImageCache[side]) {
                URL.revokeObjectURL(this._compareImageCache[side]);
            }
            const imageUrl = URL.createObjectURL(blob);
            this._compareImageCache[side] = imageUrl;

            // Keep old layer visible until the new one has loaded
            const oldLayer = this._compareLayers[side];

            // Use a custom pane for the right image so it renders above the left
            const overlayOpts = { opacity: 0.9 };
            if (side === 'right') {
                if (!map.getPane('compareRightPane')) {
                    const pane = map.createPane('compareRightPane');
                    pane.style.zIndex = '650';
                }
                overlayOpts.pane = 'compareRightPane';
            }
            const newLayer = L.imageOverlay(imageUrl, bounds, overlayOpts);
            newLayer.addTo(map);

            // Once the new image has rendered, remove the old one and update clip
            newLayer.on('load', () => {
                if (oldLayer) map.removeLayer(oldLayer);
                if (loadingEl) loadingEl.classList.add('hidden');
                requestAnimationFrame(() => this._updateCompareClip());
            });
            this._compareLayers[side] = newLayer;
            const dl = document.getElementById('compare-date-left').value || '?';
            const dr = document.getElementById('compare-date-right').value || '?';
            FunMap.Utils.setStatus(`COMPARE | ${dl} vs ${dr}`);
        } catch (err) {
            if (err.name === 'AbortError') return; // intentionally cancelled
            // Hide loading spinner on error too
            const loadEl = document.getElementById(`compare-loading-${side}`);
            if (loadEl) loadEl.classList.add('hidden');
            console.error(`Compare ${side} error:`, err);
            FunMap.Utils.toast(`Compare ${side}: ${err.message}`, 'error');
        }
    },

    // ---- Change Vector Analysis (CVA) ----

    _getCVAEvalscript() {
        // Multi-temporal CVA evalscript for Sentinel-2
        // Compares the earliest and latest orbit within the date range.
        // Outputs RGBA where color encodes change direction and alpha encodes magnitude.
        return `//VERSION=3
function setup() {
    return {
        input: [{
            bands: ["B02", "B03", "B04", "B08", "B11", "B12", "dataMask"],
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
function evaluatePixel(samples) {
    if (samples.length < 2) return [0, 0, 0, 0];
    var before = samples[0];
    var after = samples[samples.length - 1];
    if (!before.dataMask || !after.dataMask) return [0, 0, 0, 0];

    // Change vector per band
    var dBlue  = after.B02 - before.B02;
    var dGreen = after.B03 - before.B03;
    var dRed   = after.B04 - before.B04;
    var dNIR   = after.B08 - before.B08;
    var dSWIR1 = after.B11 - before.B11;
    var dSWIR2 = after.B12 - before.B12;

    // Magnitude of change vector
    var mag = Math.sqrt(dBlue*dBlue + dGreen*dGreen + dRed*dRed +
                        dNIR*dNIR + dSWIR1*dSWIR1 + dSWIR2*dSWIR2);

    // Threshold: ignore very small changes (noise)
    if (mag < 0.04) return [0, 0, 0, 0];

    // Normalize intensity (0..1), cap at reasonable max
    var intensity = Math.min(1, (mag - 0.04) / 0.3);

    // Determine dominant change direction by scoring categories:
    // Structure/reflective: increase in visible (Blue+Green) relative to SWIR
    var visIncrease = (dBlue + dGreen) / 2;
    // Earth/soil: increase in Red+SWIR, decrease or flat in NIR
    var soilScore = (dRed + dSWIR1 + dSWIR2) / 3 - dNIR * 0.5;
    // Water/moisture: increase in Blue+Green, decrease in SWIR
    var waterScore = (dBlue + dGreen) / 2 - (dSWIR1 + dSWIR2) / 2;
    // Vegetation: increase in NIR, decrease in Red
    var vegScore = dNIR - dRed;

    var scores = [
        Math.abs(visIncrease),
        Math.abs(soilScore),
        Math.abs(waterScore),
        Math.abs(vegScore)
    ];
    var maxIdx = 0;
    for (var i = 1; i < 4; i++) {
        if (scores[i] > scores[maxIdx]) maxIdx = i;
    }

    var r = 0, g = 0, b = 0;
    if (maxIdx === 0) {
        // Structure/reflective - xbox green
        r = 0.05; g = 1.0; b = 0.05;
    } else if (maxIdx === 1) {
        // Earth/soil disturbance - magenta/pink
        r = 1.0; g = 0.2; b = 0.8;
    } else if (maxIdx === 2) {
        // Water/moisture - cyan
        r = 0.2; g = 0.8; b = 1.0;
    } else {
        // Vegetation change - amber/orange
        r = 1.0; g = 0.67; b = 0.0;
    }

    return [r * intensity, g * intensity, b * intensity, intensity * 0.85];
}`;
    },

    _getCVAEvalscriptS1() {
        // Simpler CVA for Sentinel-1 (SAR) — only has VV/VH
        return `//VERSION=3
function setup() {
    return {
        input: [{
            bands: ["VV", "VH", "dataMask"],
            units: "LINEAR_POWER"
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
function evaluatePixel(samples) {
    if (samples.length < 2) return [0, 0, 0, 0];
    var before = samples[0];
    var after = samples[samples.length - 1];
    if (!before.dataMask || !after.dataMask) return [0, 0, 0, 0];

    var dVV = after.VV - before.VV;
    var dVH = after.VH - before.VH;
    var mag = Math.sqrt(dVV*dVV + dVH*dVH);

    var threshold = 0.005;
    if (mag < threshold) return [0, 0, 0, 0];

    var intensity = Math.min(1, (mag - threshold) / 0.05);

    // VV increase + VH increase = new structures (double-bounce)
    // VV decrease = removal / smoothing
    var r, g, b;
    if (dVV > 0 && dVH > 0) {
        // New structures / objects - xbox green
        r = 0.05; g = 1.0; b = 0.05;
    } else if (dVV > 0 && dVH <= 0) {
        // Surface roughening / soil disturbance - magenta
        r = 1.0; g = 0.2; b = 0.8;
    } else if (dVV < 0 && dVH < 0) {
        // Smoothing / clearing - cyan
        r = 0.2; g = 0.8; b = 1.0;
    } else {
        // Mixed change - amber
        r = 1.0; g = 0.67; b = 0.0;
    }

    return [r * intensity, g * intensity, b * intensity, intensity * 0.85];
}`;
    },

    async _runCVA() {
        if (!this._compareMode || !this._compareMap) return;

        const dateLeft = document.getElementById('compare-date-left').value;
        const dateRight = document.getElementById('compare-date-right').value;
        if (!dateLeft || !dateRight) {
            FunMap.Utils.toast('Select both BEFORE and AFTER dates to run CVA', 'warning');
            return;
        }

        // Abort any previous CVA request
        if (this._cvaAbortCtrl) this._cvaAbortCtrl.abort();
        const abortCtrl = new AbortController();
        this._cvaAbortCtrl = abortCtrl;

        const loadingEl = document.getElementById('cva-loading');
        if (loadingEl) loadingEl.classList.remove('hidden');
        FunMap.Utils.setStatus('COMPUTING CHANGE VECTOR ANALYSIS...');

        try {
            const token = await FunMap.Settings.getCDSEToken();

            const map = this._compareMap;
            const bounds = this._compareBounds || map.getBounds();
            const bbox = FunMap.Utils.bboxFromBounds(bounds);
            const mapSize = map.getSize();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = Math.min(Math.round(mapSize.x * dpr), 2500);
            const height = Math.min(Math.round(mapSize.y * dpr), 2500);

            // Order dates chronologically
            const fromDate = dateLeft < dateRight ? dateLeft : dateRight;
            const toDate = dateLeft < dateRight ? dateRight : dateLeft;

            let evalscript, dataConfig;
            if (this._compareMode === 's2') {
                evalscript = this._getCVAEvalscript();
                dataConfig = {
                    type: 'sentinel-2-l2a',
                    dataFilter: {
                        timeRange: {
                            from: fromDate + 'T00:00:00Z',
                            to: toDate + 'T23:59:59Z',
                        },
                        maxCloudCoverage: parseInt(document.getElementById('s2-cloud').value),
                        mosaickingOrder: 'mostRecent',
                    },
                };
            } else {
                evalscript = this._getCVAEvalscriptS1();
                dataConfig = {
                    type: 'sentinel-1-grd',
                    dataFilter: {
                        timeRange: {
                            from: fromDate + 'T00:00:00Z',
                            to: toDate + 'T23:59:59Z',
                        },
                        mosaickingOrder: 'mostRecent',
                    },
                    processing: {
                        backCoeff: 'GAMMA0_TERRAIN',
                        orthorectify: true,
                    },
                };
            }

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
                signal: abortCtrl.signal,
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`CVA request failed: ${response.status} - ${errText.substring(0, 200)}`);
            }

            const blob = await response.blob();

            // Revoke previous CVA URL
            if (this._cvaUrl) URL.revokeObjectURL(this._cvaUrl);
            const imageUrl = URL.createObjectURL(blob);
            this._cvaUrl = imageUrl;

            // Remove old CVA layer if any
            if (this._cvaLayer && map.hasLayer(this._cvaLayer)) {
                map.removeLayer(this._cvaLayer);
            }

            // Create a pane above everything for the CVA overlay
            if (!map.getPane('cvaPane')) {
                const pane = map.createPane('cvaPane');
                pane.style.zIndex = '660';
            }

            this._cvaLayer = L.imageOverlay(imageUrl, bounds, {
                opacity: 0.9,
                interactive: false,
                pane: 'cvaPane',
            });
            this._cvaLayer.addTo(map);
            this._cvaActive = true;

            // Show legend, download button, toggle button; highlight CVA button
            document.getElementById('cva-legend').classList.remove('hidden');
            document.getElementById('btn-download-cva').classList.remove('hidden');
            document.getElementById('btn-cva-compare').classList.add('accent');
            const toggleBtn = document.getElementById('btn-toggle-cva');
            toggleBtn.classList.remove('hidden');
            toggleBtn.classList.add('cva-on');

            // Hide compare slider & labels while CVA is shown
            this._setCVAVisible(true);

            if (loadingEl) loadingEl.classList.add('hidden');
            FunMap.Utils.setStatus(`CVA OVERLAY | ${dateLeft} vs ${dateRight}`);
            FunMap.Utils.toast('Change Vector Analysis complete — use TOGGLE CVA to compare', 'success');

        } catch (err) {
            if (err.name === 'AbortError') return;
            if (loadingEl) loadingEl.classList.add('hidden');
            console.error('CVA error:', err);
            FunMap.Utils.toast('CVA: ' + err.message, 'error');
            FunMap.Utils.setStatus('CVA ERROR');
        }
    },

    // Toggle CVA overlay visibility on/off without destroying it
    _toggleCVA() {
        if (!this._cvaLayer || !this._compareMap) return;

        const dl = document.getElementById('compare-date-left').value || '?';
        const dr = document.getElementById('compare-date-right').value || '?';

        if (this._cvaActive) {
            // Hide CVA, show compare view
            this._setCVAVisible(false);
            this._cvaActive = false;
            FunMap.Utils.setStatus(`COMPARE | ${dl} vs ${dr}`);
        } else {
            // Show CVA, hide compare slider
            this._setCVAVisible(true);
            this._cvaActive = true;
            FunMap.Utils.setStatus(`CVA OVERLAY | ${dl} vs ${dr}`);
        }
    },

    // Show or hide CVA overlay and associated UI elements
    _setCVAVisible(visible) {
        // CVA layer
        if (this._cvaLayer) {
            if (visible) {
                if (!this._compareMap.hasLayer(this._cvaLayer)) {
                    this._cvaLayer.addTo(this._compareMap);
                }
            } else {
                if (this._compareMap.hasLayer(this._cvaLayer)) {
                    this._compareMap.removeLayer(this._cvaLayer);
                }
            }
        }

        // Legend
        const legend = document.getElementById('cva-legend');
        if (legend) legend.classList.toggle('hidden', !visible);

        // Toggle button state
        const toggleBtn = document.getElementById('btn-toggle-cva');
        if (toggleBtn) toggleBtn.classList.toggle('cva-on', visible);

        // Compare slider & labels — hide when CVA is visible, show when not
        const slider = document.getElementById('compare-slider');
        if (slider) slider.style.display = visible ? 'none' : '';
        const labelLeft = document.querySelector('.compare-label-left');
        if (labelLeft) labelLeft.style.display = visible ? 'none' : '';
        const labelRight = document.querySelector('.compare-label-right');
        if (labelRight) labelRight.style.display = visible ? 'none' : '';

        // Reset clip on right image when returning to compare view
        if (!visible) {
            requestAnimationFrame(() => this._updateCompareClip());
        }
    },

    // Fully destroy CVA state (used on close or when APPLY changes images)
    _removeCVA() {
        if (this._cvaAbortCtrl) { this._cvaAbortCtrl.abort(); this._cvaAbortCtrl = null; }
        if (this._cvaLayer && this._compareMap && this._compareMap.hasLayer(this._cvaLayer)) {
            this._compareMap.removeLayer(this._cvaLayer);
        }
        this._cvaLayer = null;
        if (this._cvaUrl) { URL.revokeObjectURL(this._cvaUrl); this._cvaUrl = null; }
        this._cvaActive = false;

        const legend = document.getElementById('cva-legend');
        if (legend) legend.classList.add('hidden');
        const dlBtn = document.getElementById('btn-download-cva');
        if (dlBtn) dlBtn.classList.add('hidden');
        const cvaBtn = document.getElementById('btn-cva-compare');
        if (cvaBtn) cvaBtn.classList.remove('accent');
        const toggleBtn = document.getElementById('btn-toggle-cva');
        if (toggleBtn) { toggleBtn.classList.add('hidden'); toggleBtn.classList.remove('cva-on'); }
        const loadingEl = document.getElementById('cva-loading');
        if (loadingEl) loadingEl.classList.add('hidden');

        // Restore compare slider & labels
        this._setCVAVisible(false);

        if (this._compareMode) FunMap.Utils.setStatus('COMPARE MODE ACTIVE');
    },

    _downloadCVA() {
        if (!this._cvaUrl) {
            FunMap.Utils.toast('No CVA overlay to download', 'warning');
            return;
        }
        const dateLeft = document.getElementById('compare-date-left').value || 'before';
        const dateRight = document.getElementById('compare-date-right').value || 'after';
        const filename = `CVA_${dateLeft}_to_${dateRight}.png`;

        // Composite CVA over satellite (after) image
        const satUrl = this._compareImageCache.right;
        if (!satUrl) {
            // No satellite base — download CVA alone
            const a = document.createElement('a');
            a.href = this._cvaUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            FunMap.Utils.toast('CVA image downloaded', 'success');
            return;
        }

        const satImg = new Image();
        const cvaImg = new Image();
        let loaded = 0;

        const onBothLoaded = () => {
            const canvas = document.createElement('canvas');
            canvas.width = satImg.naturalWidth;
            canvas.height = satImg.naturalHeight;
            const ctx = canvas.getContext('2d');
            // Draw satellite base
            ctx.drawImage(satImg, 0, 0, canvas.width, canvas.height);
            // Draw CVA overlay on top
            ctx.drawImage(cvaImg, 0, 0, canvas.width, canvas.height);

            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                FunMap.Utils.toast('CVA composite image downloaded', 'success');
            }, 'image/png');
        };

        const tryComplete = () => { if (++loaded === 2) onBothLoaded(); };
        satImg.onload = tryComplete;
        cvaImg.onload = tryComplete;
        satImg.onerror = () => {
            // Fallback: download CVA only
            const a = document.createElement('a');
            a.href = this._cvaUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            FunMap.Utils.toast('CVA image downloaded (without satellite base)', 'success');
        };
        cvaImg.onerror = satImg.onerror;

        satImg.src = satUrl;
        cvaImg.src = this._cvaUrl;
    },


    _closeCompare() {
        // Remove button handlers
        if (this._compareHandlers) {
            document.getElementById('btn-apply-compare').removeEventListener('click', this._compareHandlers.apply);
            document.getElementById('btn-cva-compare').removeEventListener('click', this._compareHandlers.cva);
            document.getElementById('btn-toggle-cva').removeEventListener('click', this._compareHandlers.toggleCva);
            document.getElementById('btn-download-cva').removeEventListener('click', this._compareHandlers.downloadCva);
            this._compareHandlers = null;
        }

        // Remove document-level slider listeners
        if (this._sliderHandlers) {
            document.removeEventListener('mousemove', this._sliderHandlers.mouseMove);
            document.removeEventListener('mouseup', this._sliderHandlers.mouseUp);
            document.removeEventListener('touchmove', this._sliderHandlers.touchMove);
            document.removeEventListener('touchend', this._sliderHandlers.touchEnd);
            this._sliderHandlers = null;
        }

        // Clear auto-reload timer and abort in-flight image requests
        clearTimeout(this._compareMoveTimer);
        this._compareMoveTimer = null;
        if (this._compareAbortCtrl.left) { this._compareAbortCtrl.left.abort(); this._compareAbortCtrl.left = null; }
        if (this._compareAbortCtrl.right) { this._compareAbortCtrl.right.abort(); this._compareAbortCtrl.right = null; }

        // Clean up CVA
        this._removeCVA();

        // Capture compare map position before destroying it
        let compareCenter = null;
        let compareZoom = null;
        if (this._compareMap) {
            compareCenter = this._compareMap.getCenter();
            compareZoom = this._compareMap.getZoom();
            this._compareMap.remove();
            this._compareMap = null;
        }
        // Revoke cached image URLs
        if (this._compareImageCache.left) URL.revokeObjectURL(this._compareImageCache.left);
        if (this._compareImageCache.right) URL.revokeObjectURL(this._compareImageCache.right);
        this._compareImageCache = { left: null, right: null };
        this._compareLayers = { left: null, right: null };
        this._compareBounds = null;
        this._compareMode = null;
        this._compareLoadGen = { left: 0, right: 0 };

        // Clear map container for reinit
        document.getElementById('compare-map-single').innerHTML = '';

        // Show main map, hide compare
        document.getElementById('map').style.display = '';
        document.getElementById('compare-container').classList.add('hidden');
        document.getElementById('compare-toolbar').classList.add('hidden');

        // Force main map to recalculate size, then sync to compare viewport
        FunMap.Map.map.invalidateSize();
        if (compareCenter && compareZoom != null) {
            FunMap.Map.map.setView(compareCenter, compareZoom, { animate: false });
        }
        document.getElementById('zoom-level').textContent =
            Math.round(FunMap.Map.getZoom());
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

        // Attach calendars to change detection date inputs
        const changeCalOpts = {
            onOpen: () => this.refreshChangeDatesAvailable(),
        };
        FunMap.Calendar.attach('change-date-a', changeCalOpts);
        FunMap.Calendar.attach('change-date-b', changeCalOpts);

        // Set default dates
        FunMap.Calendar.setValue('change-date-a', FunMap.Utils.daysAgo(30));
        FunMap.Calendar.setValue('change-date-b', FunMap.Utils.daysAgo(0));

        // Fetch available S1 dates for the date pickers
        this.refreshChangeDatesAvailable();

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
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = Math.min(Math.round(mapSize.x * dpr), 2500);
            const height = Math.min(Math.round(mapSize.y * dpr), 2500);

            // Custom evalscript for change detection with the threshold
            const evalscript = `//VERSION=3
function setup() {
    return {
        input: [{
            bands: ["VV", "dataMask"]
        }],
        output: { bands: 4 },
        mosaicking: "ORBIT"
    };
}
function toDb(val) {
    return 10 * Math.log10(Math.max(val, 1e-10));
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
    let beforeDb = toDb(before.VV);
    let afterDb = toDb(after.VV);
    let diff = afterDb - beforeDb;
    let threshold = ${threshold};
    let r = 0, g = 0, b = 0, a = 1;
    if (diff > threshold) {
        let intensity = Math.min(1, (diff - threshold) / 5);
        r = 1; g = 0.2 * (1 - intensity); b = 0;
    } else if (diff < -threshold) {
        let intensity = Math.min(1, (-diff - threshold) / 5);
        r = 0; g = 0.2 * (1 - intensity); b = 1;
    } else {
        let v = (afterDb + 20) / 25;
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
