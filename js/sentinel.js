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
    _fetchGeneration: {},  // keyed by calendar group, cancels stale fetches

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
        this.refreshGlobalAvailableDates();
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
        this.refreshGlobalAvailableDates();
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

        // Set default dates
        const dates = FunMap.UI.getDateRange();
        FunMap.Calendar.setValue('compare-date-left', FunMap.Utils.daysAgo(30));
        FunMap.Calendar.setValue('compare-date-right', dates.to);

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
                FunMap.Utils.toast('Compare images updating...', 'info');
            },
        };
        document.getElementById('btn-apply-compare').addEventListener('click', this._compareHandlers.apply);

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
        // Clip the right image's custom pane at the slider position.
        // We clip the PANE rather than the image element because Leaflet
        // positions images with CSS transforms (translate3d + scale during
        // zoom).  clipPath:inset() operates in pre-transform local coords
        // while getBoundingClientRect() returns post-transform values,
        // causing diagonal/offset glitches.  The pane has no transform so
        // container-relative pixel values map directly.
        if (!this._compareMap) return;
        const pane = this._compareMap.getPane('compareRightPane');
        if (pane) {
            const containerWidth = document.getElementById('compare-container').offsetWidth;
            const sliderPx = this._sliderPos * containerWidth;
            pane.style.clipPath = `inset(0 0 0 ${sliderPx}px)`;
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

            const from = FunMap.Utils.daysAgo(730); // ~2 years
            const to = FunMap.Utils.toISODate(new Date());
            const dateSet = new Set();
            let nextToken = null;
            const maxPages = 10; // safety cap

            for (let page = 0; page < maxPages; page++) {
                // Abort if a newer fetch has started for this calendar group
                if (this._fetchGeneration[fetchKey] !== generation) return [];

                const searchBody = {
                    bbox: bbox,
                    datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
                    collections: [collectionId],
                    limit: 100,
                    fields: { include: ['properties.datetime'] },
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
                            dateSet.add(f.properties.datetime.split('T')[0]);
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
                    const sortedSoFar = Array.from(dateSet).sort().reverse();
                    FunMap.Calendar.setAvailableDatesMulti(calendarInputIds, sortedSoFar);
                }
            }

            // Final update (only if still the latest request)
            if (this._fetchGeneration[fetchKey] !== generation) return [];

            const sortedDates = Array.from(dateSet).sort().reverse();

            // Only update calendars if we actually got results — don't wipe
            // existing dates when the API fails (e.g. token expired mid-request)
            if (sortedDates.length > 0) {
                FunMap.Calendar.setAvailableDatesMulti(calendarInputIds, sortedDates);
            }

            if (showToast && sortedDates.length > 0) {
                FunMap.Utils.toast(`${sortedDates.length} image dates available`, 'info');
            }
            return sortedDates;
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

    // Fetch available dates for global date filter pickers
    // No zoom restriction — dates exist regardless of current zoom level
    async refreshGlobalAvailableDates() {
        const clientId = FunMap.Settings.getApiKey('cdse_client_id');
        if (!clientId) return;

        const bounds = FunMap.Map.getBounds();
        const s2Active = document.getElementById('layer-sentinel2').checked;
        const s1Active = document.getElementById('layer-sentinel1').checked;
        const collectionId = s2Active ? 'sentinel-2-l2a' : (s1Active ? 'sentinel-1-grd' : 'sentinel-2-l2a');

        await this.fetchAvailableDatesFor(collectionId, bounds,
            ['global-date-from', 'global-date-to'], false);
    },

    // Fetch available dates for change detection
    async refreshChangeDatesAvailable() {
        const clientId = FunMap.Settings.getApiKey('cdse_client_id');
        if (!clientId) return;

        const bounds = FunMap.Map.getBounds();
        await this.fetchAvailableDatesFor('sentinel-1-grd', bounds,
            ['change-date-a', 'change-date-b'], false);
    },

    async _loadCompareImage(side) {
        if (!this._compareMode || !this._compareMap) return;

        // Generation counter prevents stale responses from overwriting newer ones
        const gen = ++this._compareLoadGen[side];

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

            // Use a date window sized to the sensor's revisit period so we're
            // likely to capture at least one full pass over the area.
            // S2 revisit ≈ 5 days, S1 revisit ≈ 12 days.
            const halfWindow = this._compareMode === 's1' ? 12 : 5;
            const fromDate = new Date(dateVal);
            fromDate.setDate(fromDate.getDate() - halfWindow);
            const toDate = new Date(dateVal);
            toDate.setDate(toDate.getDate() + halfWindow);
            dataConfig.dataFilter.timeRange = {
                from: FunMap.Utils.toISODate(fromDate) + 'T00:00:00Z',
                to: FunMap.Utils.toISODate(toDate) + 'T23:59:59Z',
            };

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
            });

            if (!response.ok) throw new Error(`Compare image failed: ${response.status}`);

            const blob = await response.blob();

            // Abort if a newer request has superseded this one
            if (this._compareLoadGen[side] !== gen) {
                URL.revokeObjectURL(URL.createObjectURL(blob));
                return;
            }

            // Revoke old cached URL
            if (this._compareImageCache[side]) {
                URL.revokeObjectURL(this._compareImageCache[side]);
            }
            const imageUrl = URL.createObjectURL(blob);
            this._compareImageCache[side] = imageUrl;

            if (this._compareLayers[side]) {
                map.removeLayer(this._compareLayers[side]);
            }

            // Put right image in its own custom pane so we can clip it
            // without affecting the left image (both share overlayPane otherwise)
            const overlayOpts = { opacity: 0.9 };
            if (side === 'right') {
                if (!map.getPane('compareRightPane')) {
                    const pane = map.createPane('compareRightPane');
                    pane.style.zIndex = '650';
                }
                overlayOpts.pane = 'compareRightPane';
            }
            this._compareLayers[side] = L.imageOverlay(imageUrl, bounds, overlayOpts);
            this._compareLayers[side].addTo(map);

            // Apply clip after image loads (wait a frame for Leaflet positioning)
            if (side === 'right') {
                this._compareLayers[side].on('load', () => {
                    requestAnimationFrame(() => this._updateCompareClip());
                });
            }

            // Hide loading spinner
            if (loadingEl) loadingEl.classList.add('hidden');
            FunMap.Utils.setStatus('COMPARE MODE ACTIVE');
        } catch (err) {
            // Hide loading spinner on error too
            const loadEl = document.getElementById(`compare-loading-${side}`);
            if (loadEl) loadEl.classList.add('hidden');
            console.error(`Compare ${side} error:`, err);
            FunMap.Utils.toast(`Compare ${side}: ${err.message}`, 'error');
        }
    },

    _closeCompare() {
        // Remove Apply handler
        if (this._compareHandlers) {
            document.getElementById('btn-apply-compare').removeEventListener('click', this._compareHandlers.apply);
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

        // Destroy compare map
        if (this._compareMap) {
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

        // Force main map to recalculate size and restore zoom ticker
        FunMap.Map.map.invalidateSize();
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
            const width = Math.min(mapSize.x, 2048);
            const height = Math.min(mapSize.y, 2048);

            // Custom evalscript for change detection with the threshold
            const evalscript = `//VERSION=3
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
