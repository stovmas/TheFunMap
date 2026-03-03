/* ============================================
   THE FUN MAP - UI Controls & Interactions
   ============================================ */

FunMap.UI = {
    _measurePoints: [],
    _measureLayers: null,
    _measuringActive: false,

    init() {
        this._measureLayers = L.layerGroup().addTo(FunMap.Map.map);

        // Sidebar toggle
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.toggle('open');
            setTimeout(() => FunMap.Map.map.invalidateSize(), 300);
        });

        // Section toggles
        document.querySelectorAll('.section-header[data-toggle]').forEach(header => {
            header.addEventListener('click', () => {
                const targetId = header.dataset.toggle;
                const body = document.getElementById(targetId);
                body.classList.toggle('open');
            });
        });

        // Date filter
        this._initDateFilter();

        // Geocode
        this._initGeocode();

        // Measurement
        this._initMeasure();

        // Settings
        this._initSettings();

        // Close panel buttons
        document.querySelectorAll('.close-panel').forEach(btn => {
            btn.addEventListener('click', () => {
                const panelId = btn.dataset.close;
                document.getElementById(panelId).classList.add('hidden');
                // If closing measure panel, fully deactivate measurement
                if (panelId === 'measure-panel' && this._measuringActive) {
                    this._deactivateMeasure();
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Close compare mode properly (not just hide the panel)
                if (FunMap.Sentinel._compareMode) {
                    FunMap.Sentinel._closeCompare();
                    return;
                }
                // Close change detection properly
                if (FunMap.Sentinel._changeMode) {
                    FunMap.Sentinel._closeChangeDetection();
                    return;
                }
                // Cancel Janus drawing if active
                if (FunMap.Janus._drawMode) {
                    FunMap.Janus._cancelDraw();
                    return;
                }
                // Deactivate measurement if active
                if (this._measuringActive) {
                    this._deactivateMeasure();
                }
                // Close any open modals/panels
                document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
                document.querySelectorAll('.floating-panel:not(.hidden)').forEach(p => p.classList.add('hidden'));
            }
        });

        // Initial layer count
        FunMap.Map.updateLayerCount();
    },

    // ---- Per-dataset Date Pickers ----

    _initDateFilter() {
        const today = FunMap.Utils.toISODate(new Date());

        // Sentinel-2 date picker — defaults to today, refreshes on change
        FunMap.Calendar.attach('s2-date', {
            onOpen: () => FunMap.Sentinel.refreshS2AvailableDates(),
        });
        FunMap.Calendar.setValue('s2-date', today);
        document.getElementById('s2-date').addEventListener('change', () => {
            if (document.getElementById('layer-sentinel2').checked) {
                FunMap.Sentinel._refreshS2();
            }
        });

        // Sentinel-1 date picker — defaults to today, refreshes on change
        FunMap.Calendar.attach('s1-date', {
            onOpen: () => FunMap.Sentinel.refreshS1AvailableDates(),
        });
        FunMap.Calendar.setValue('s1-date', today);
        document.getElementById('s1-date').addEventListener('change', () => {
            if (document.getElementById('layer-sentinel1').checked) {
                FunMap.Sentinel._refreshS1();
            }
        });

        // Conflict date pickers — FROM/TO range, defaults to last 30 days
        FunMap.Calendar.attach('conflict-date-from');
        FunMap.Calendar.attach('conflict-date-to');
        FunMap.Calendar.setValue('conflict-date-from', FunMap.Utils.daysAgo(30));
        FunMap.Calendar.setValue('conflict-date-to', today);
        document.getElementById('conflict-date-from').addEventListener('change', () => {
            if (document.getElementById('layer-conflict').checked) {
                FunMap.Conflict.reload();
            }
        });
        document.getElementById('conflict-date-to').addEventListener('change', () => {
            if (document.getElementById('layer-conflict').checked) {
                FunMap.Conflict.reload();
            }
        });
    },

    // ---- Geocode ----

    _initGeocode() {
        const panel = document.getElementById('geocode-panel');
        const input = document.getElementById('geocode-input');
        const results = document.getElementById('geocode-results');

        document.getElementById('btn-geocode').addEventListener('click', () => {
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                input.focus();
            }
        });

        const doSearch = async () => {
            const query = input.value.trim();
            if (!query) return;

            // Check if it's coordinates (lat, lng)
            const coordMatch = query.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
            if (coordMatch) {
                const lat = parseFloat(coordMatch[1]);
                const lng = parseFloat(coordMatch[2]);
                FunMap.Map.flyTo(lat, lng, 12);
                panel.classList.add('hidden');
                return;
            }

            // Use Nominatim for geocoding
            try {
                FunMap.Utils.setStatus('SEARCHING...');
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
                    { headers: { 'Accept-Language': 'en' } }
                );
                const data = await response.json();

                results.innerHTML = '';
                if (data.length === 0) {
                    results.innerHTML = '<div class="empty-state">No results found.</div>';
                    FunMap.Utils.setStatus('NO RESULTS');
                    return;
                }

                data.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.innerHTML = `<div class="result-name">${item.display_name.split(',')[0]}</div>
                        <div class="result-type">${item.display_name}</div>`;
                    div.addEventListener('click', () => {
                        FunMap.Map.flyTo(parseFloat(item.lat), parseFloat(item.lon), 12);
                        panel.classList.add('hidden');
                        results.innerHTML = '';
                        input.value = '';
                    });
                    results.appendChild(div);
                });

                FunMap.Utils.setStatus('SYSTEMS ONLINE');
            } catch (err) {
                FunMap.Utils.toast('Geocode search failed: ' + err.message, 'error');
                FunMap.Utils.setStatus('SEARCH ERROR');
            }
        };

        document.getElementById('btn-geocode-search').addEventListener('click', doSearch);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch();
        });
    },

    // ---- Measurement ----

    _initMeasure() {
        const btn = document.getElementById('btn-measure');
        btn.addEventListener('click', () => {
            if (this._measuringActive) {
                // Deactivate measurement mode (lines stay on map)
                this._deactivateMeasure();
            } else if (this._measureLayers.getLayers().length > 0) {
                // Has existing measurements - show panel to manage them
                document.getElementById('measure-panel').classList.toggle('hidden');
            } else {
                // Start fresh measurement
                document.getElementById('measure-panel').classList.remove('hidden');
                this._startMeasure();
            }
        });

        document.getElementById('btn-measure-clear').addEventListener('click', () => {
            this._clearMeasure();
            // If still in active mode, ready for new measurements
        });

        // DONE / DEACTIVATE button
        document.getElementById('btn-measure-done').addEventListener('click', () => {
            this._deactivateMeasure();
        });
    },

    _startMeasure() {
        // Remove any existing handlers first to prevent stacking
        if (this._measureClickHandler) {
            FunMap.Map.map.off('click', this._measureClickHandler);
            FunMap.Map.map.off('dblclick', this._measureDblClickHandler);
        }

        this._measuringActive = true;
        this._measurePoints = [];
        const btn = document.getElementById('btn-measure');
        btn.classList.add('measure-active');
        FunMap.Map.map.getContainer().style.cursor = 'crosshair';
        FunMap.Utils.setStatus('MEASUREMENT MODE - CLICK TO ADD POINTS');

        this._measureClickHandler = (e) => {
            this._addMeasurePoint(e.latlng);
        };
        this._measureDblClickHandler = (e) => {
            L.DomEvent.stopPropagation(e);
            this._finishMeasure();
        };

        FunMap.Map.map.on('click', this._measureClickHandler);
        FunMap.Map.map.on('dblclick', this._measureDblClickHandler);
    },

    _stopMeasure() {
        FunMap.Map.map.getContainer().style.cursor = '';
        FunMap.Map.map.off('click', this._measureClickHandler);
        FunMap.Map.map.off('dblclick', this._measureDblClickHandler);
    },

    _deactivateMeasure() {
        this._stopMeasure();
        this._measuringActive = false;
        document.getElementById('btn-measure').classList.remove('measure-active');
        document.getElementById('measure-panel').classList.add('hidden');
        // Lines/markers stay on the map - only CLEAR button removes them
        FunMap.Utils.setStatus('SYSTEMS ONLINE');
    },

    _addMeasurePoint(latlng) {
        this._measurePoints.push(latlng);

        // Add marker
        const marker = L.circleMarker(latlng, {
            radius: 4,
            fillColor: '#87c540',
            color: '#ffffff',
            weight: 2,
            fillOpacity: 1,
        });
        this._measureLayers.addLayer(marker);

        // Add line if more than 1 point
        if (this._measurePoints.length > 1) {
            const line = L.polyline(
                [this._measurePoints[this._measurePoints.length - 2], latlng],
                { color: '#87c540', weight: 2, dashArray: '6, 6' }
            );
            this._measureLayers.addLayer(line);
        }

        this._updateMeasureDisplay();
    },

    _finishMeasure() {
        if (this._measurePoints.length >= 3) {
            // Close polygon
            const polygon = L.polygon(this._measurePoints, {
                color: '#87c540',
                weight: 2,
                fillColor: '#87c540',
                fillOpacity: 0.1,
                dashArray: '6, 6',
            });
            this._measureLayers.addLayer(polygon);
        }
        this._stopMeasure();
        this._updateMeasureDisplay();
        // After finish, user can click measure button to fully deactivate
    },

    _clearMeasure() {
        this._measurePoints = [];
        this._measureLayers.clearLayers();
        document.getElementById('measure-distance').textContent = '--';
        document.getElementById('measure-area').textContent = '--';
    },

    _updateMeasureDisplay() {
        let totalDist = 0;
        for (let i = 1; i < this._measurePoints.length; i++) {
            const p1 = this._measurePoints[i - 1];
            const p2 = this._measurePoints[i];
            totalDist += FunMap.Utils.haversine(p1.lat, p1.lng, p2.lat, p2.lng);
        }

        document.getElementById('measure-distance').textContent = FunMap.Utils.formatDistance(totalDist);

        if (this._measurePoints.length >= 3) {
            const area = FunMap.Utils.polygonArea(this._measurePoints);
            document.getElementById('measure-area').textContent = FunMap.Utils.formatArea(area);
        }
    },

    // ---- Settings ----

    _initSettings() {
        const dialog = document.getElementById('settings-dialog');

        document.getElementById('btn-settings').addEventListener('click', () => {
            this._loadSettingsValues();
            dialog.classList.remove('hidden');
        });

        dialog.querySelector('.close-modal').addEventListener('click', () => {
            dialog.classList.add('hidden');
        });

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.classList.add('hidden');
        });

        // Tab switching
        dialog.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                dialog.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                dialog.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            });
        });

        // Save button
        document.getElementById('btn-settings-save').addEventListener('click', () => {
            this._saveSettings();
        });

        // Sentinel zoom display
        const zoomSlider = document.getElementById('setting-sentinel-zoom');
        const zoomVal = document.getElementById('setting-sentinel-zoom-val');
        zoomSlider.addEventListener('input', () => {
            zoomVal.textContent = zoomSlider.value;
        });
    },

    _loadSettingsValues() {
        document.getElementById('setting-cdse-client-id').value = FunMap.Settings.getApiKey('cdse_client_id');
        document.getElementById('setting-cdse-client-secret').value = FunMap.Settings.getApiKey('cdse_client_secret');
        document.getElementById('setting-firms-key').value = FunMap.Settings.getApiKey('firms_key');
        document.getElementById('setting-acled-key').value = FunMap.Settings.getApiKey('acled_key');
        document.getElementById('setting-acled-email').value = FunMap.Settings.getApiKey('acled_email');
        document.getElementById('setting-sentinel-zoom').value = FunMap.Settings.get('sentinel_zoom', 10);
        document.getElementById('setting-sentinel-zoom-val').textContent = FunMap.Settings.get('sentinel_zoom', 10);
        document.getElementById('setting-animate-bg').checked = FunMap.Settings.get('animate_bg', true);
        document.getElementById('setting-show-graticule').checked = FunMap.Settings.get('show_graticule', false);
    },

    _saveSettings() {
        FunMap.Settings.setApiKey('cdse_client_id', document.getElementById('setting-cdse-client-id').value.trim());
        FunMap.Settings.setApiKey('cdse_client_secret', document.getElementById('setting-cdse-client-secret').value.trim());
        FunMap.Settings.setApiKey('firms_key', document.getElementById('setting-firms-key').value.trim());
        FunMap.Settings.setApiKey('acled_key', document.getElementById('setting-acled-key').value.trim());
        FunMap.Settings.setApiKey('acled_email', document.getElementById('setting-acled-email').value.trim());
        FunMap.Settings.set('sentinel_zoom', parseInt(document.getElementById('setting-sentinel-zoom').value));
        FunMap.Settings.set('animate_bg', document.getElementById('setting-animate-bg').checked);
        FunMap.Settings.set('show_graticule', document.getElementById('setting-show-graticule').checked);

        // Clear cached CDSE token if credentials changed
        FunMap.Settings._cdseToken = null;
        FunMap.Settings._cdseTokenExpiry = 0;

        document.getElementById('settings-dialog').classList.add('hidden');
        FunMap.Utils.toast('Settings saved', 'success');
    },

    // ---- Legend ----

    updateLegend() {
        const content = document.getElementById('legend-content');
        let html = '';

        // FIRMS legend
        if (document.getElementById('layer-firms').checked) {
            const colorBy = document.getElementById('firms-color').value;
            html += '<div class="legend-section"><div class="legend-title">NASA FIRMS - FIRE DETECTIONS</div>';

            if (colorBy === 'confidence') {
                html += `
                    <div class="legend-item"><div class="legend-color" style="background:#ff0000"></div> High confidence</div>
                    <div class="legend-item"><div class="legend-color" style="background:#ff6600"></div> Nominal confidence</div>
                    <div class="legend-item"><div class="legend-color" style="background:#ffcc00"></div> Low confidence</div>`;
            } else if (colorBy === 'frp') {
                html += `
                    <div class="legend-gradient" style="background:linear-gradient(90deg,#ffcc00,#ff8800,#ff0000)"></div>
                    <div class="legend-labels"><span>0 MW</span><span>100 MW</span><span>500+ MW</span></div>`;
            } else {
                html += `
                    <div class="legend-gradient" style="background:linear-gradient(90deg,#ffcc00,#ff8800,#ff0000)"></div>
                    <div class="legend-labels"><span>300 K</span><span>350 K</span><span>400+ K</span></div>`;
            }
            html += '</div>';
        }

        // Conflict legend
        if (document.getElementById('layer-conflict').checked) {
            const source = document.getElementById('conflict-source').value;
            html += `<div class="legend-section"><div class="legend-title">CONFLICT EVENTS (${source.toUpperCase()})</div>`;

            if (source === 'acled') {
                html += `
                    <div class="legend-item"><div class="legend-color" style="background:#ff3333;border-radius:50%"></div> Battles</div>
                    <div class="legend-item"><div class="legend-color" style="background:#ff6600;border-radius:50%"></div> Explosions/Remote</div>
                    <div class="legend-item"><div class="legend-color" style="background:#cc0066;border-radius:50%"></div> Violence vs Civilians</div>
                    <div class="legend-item"><div class="legend-color" style="background:#ffcc00;border-radius:50%"></div> Protests</div>
                    <div class="legend-item"><div class="legend-color" style="background:#ff9900;border-radius:50%"></div> Riots</div>
                    <div class="legend-item"><div class="legend-color" style="background:#9966ff;border-radius:50%"></div> Strategic</div>`;
            } else {
                html += `
                    <div class="legend-item"><div class="legend-color" style="background:#ff3333;border-radius:50%"></div> State-based conflict</div>
                    <div class="legend-item"><div class="legend-color" style="background:#ff6600;border-radius:50%"></div> Non-state conflict</div>
                    <div class="legend-item"><div class="legend-color" style="background:#cc0066;border-radius:50%"></div> One-sided violence</div>`;
            }
            html += '<div style="font-size:10px;color:var(--xbox-text-dim);margin-top:4px;">Size = fatalities</div></div>';
        }

        // Sentinel-2 legend
        if (document.getElementById('layer-sentinel2').checked) {
            const viz = document.getElementById('s2-visualization').value;
            html += '<div class="legend-section"><div class="legend-title">SENTINEL-2</div>';

            if (viz === 'NDVI') {
                html += `
                    <div class="legend-gradient" style="background:linear-gradient(90deg,#0d0d0d,#bfbfbf,#ebeb99,#a8d441,#316e21,#005900)"></div>
                    <div class="legend-labels"><span>-1 (Water)</span><span>0</span><span>1 (Dense veg.)</span></div>`;
            } else if (viz === 'NDWI') {
                html += `
                    <div class="legend-gradient" style="background:linear-gradient(90deg,#997f33,#cca626,#e6e6b3,#80d9e6,#0066cc,#0000ff)"></div>
                    <div class="legend-labels"><span>-1 (Dry)</span><span>0</span><span>1 (Water)</span></div>`;
            } else if (viz === 'FALSE_COLOR') {
                html += '<div style="font-size:10px;color:var(--xbox-text-dim);">Red = Vegetation, Blue/Cyan = Water, Gray = Urban/Bare</div>';
            } else {
                html += '<div style="font-size:10px;color:var(--xbox-text-dim);">Natural color composite (B4, B3, B2)</div>';
            }
            html += '</div>';
        }

        // Sentinel-1 legend
        if (document.getElementById('layer-sentinel1').checked) {
            html += '<div class="legend-section"><div class="legend-title">SENTINEL-1 SAR</div>';
            html += '<div style="font-size:10px;color:var(--xbox-text-dim);">Bright = high backscatter (urban, rough), Dark = low backscatter (water, smooth)</div>';
            html += '</div>';
        }

        // Pins legend
        if (document.getElementById('layer-pins').checked && FunMap.Pins._pins.length > 0) {
            html += '<div class="legend-section"><div class="legend-title">USER PINS</div>';
            html += `<div style="font-size:10px;color:var(--xbox-text-dim);">${FunMap.Pins._pins.length} pin(s) placed</div>`;
            html += '</div>';
        }

        if (html === '') {
            html = '<div class="empty-state">Enable a layer to see its legend.</div>';
        }

        content.innerHTML = html;
    },
};
