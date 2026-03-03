/* ============================================
   THE FUN MAP - NASA FIRMS Fire Data
   ============================================ */

FunMap.FIRMS = {
    _layerGroup: null,
    _data: [],
    _abortCtrls: [],

    init() {
        this._layerGroup = L.layerGroup();

        // Layer toggle
        document.getElementById('layer-firms').addEventListener('change', (e) => {
            if (e.target.checked) {
                this._enable();
            } else {
                this._disable();
            }
            FunMap.Map.updateLayerCount();
            FunMap.UI.updateLegend();
        });

        // Attach calendar to the FIRMS date picker
        FunMap.Calendar.attach('firms-date');

        // Satellite checkbox, range, date, color changes all trigger reload
        document.querySelectorAll('.firms-source-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                if (document.getElementById('layer-firms').checked) {
                    this._loadData();
                }
            });
        });
        ['firms-range', 'firms-date', 'firms-color'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                if (document.getElementById('layer-firms').checked) {
                    this._loadData();
                }
            });
        });
    },

    _getSelectedSources() {
        const sources = [];
        document.querySelectorAll('.firms-source-cb:checked').forEach(cb => {
            sources.push(cb.value);
        });
        return sources;
    },

    _enable() {
        this._layerGroup.addTo(FunMap.Map.map);
        this._loadData();
    },

    _disable() {
        this._abortCtrls.forEach(c => c.abort());
        this._abortCtrls = [];
        FunMap.Map.map.removeLayer(this._layerGroup);
        this._layerGroup.clearLayers();
        this._data = [];
    },

    async _loadData() {
        // Cancel any in-flight requests
        this._abortCtrls.forEach(c => c.abort());
        this._abortCtrls = [];

        const firmsKey = FunMap.Settings.getApiKey('firms_key');
        if (!firmsKey) {
            FunMap.Utils.toast('Configure NASA FIRMS MAP Key in Settings to load fire data', 'warning');
            return;
        }

        const sources = this._getSelectedSources();
        if (sources.length === 0) {
            FunMap.Utils.toast('Select at least one satellite source', 'warning');
            this._layerGroup.clearLayers();
            this._data = [];
            return;
        }

        const range = document.getElementById('firms-range').value;
        const dateVal = document.getElementById('firms-date').value; // YYYY-MM-DD or empty
        const bounds = FunMap.Map.getBounds();
        const bbox = FunMap.Utils.bboxFromBounds(bounds);

        // Use bounding box for the current view
        const area = `${bbox[0].toFixed(2)},${bbox[1].toFixed(2)},${bbox[2].toFixed(2)},${bbox[3].toFixed(2)}`;

        FunMap.Utils.setStatus('LOADING FIRE DATA...');

        // Fetch all selected sources in parallel
        const fetches = sources.map(source => {
            const abortCtrl = new AbortController();
            this._abortCtrls.push(abortCtrl);

            let url = `${FunMap.Config.FIRMS.areaEndpoint}/csv/${firmsKey}/${source}/${area}/${range}`;
            if (dateVal) url += `/${dateVal}`;

            return this._fetchSource(url, source, abortCtrl);
        });

        try {
            const results = await Promise.all(fetches);
            this._data = results.flat();

            this._renderData(this._data);

            const sourceNames = sources.map(s => FunMap.Config.FIRMS.sources[s] || s).join(', ');
            FunMap.Utils.setStatus(`${this._data.length} FIRE DETECTIONS | ${sourceNames}`);

            if (this._data.length === 0) {
                FunMap.Utils.toast('No fire detections found in this area/timeframe', 'info');
            }

        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('FIRMS error:', err);
            FunMap.Utils.toast('FIRMS: ' + err.message, 'error');
            FunMap.Utils.setStatus('FIRMS ERROR');
        }
    },

    async _fetchSource(url, source, abortCtrl) {
        const response = await fetch(url, { signal: abortCtrl.signal });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error(`FIRMS ${source}: HTTP ${response.status}`, errText.substring(0, 300));
            throw new Error(`FIRMS API error (${source}): ${response.status}`);
        }

        const csv = await response.text();

        // FIRMS API returns error messages as plain text with 200 status.
        // Detect these before trying to parse as CSV.
        if (!csv.includes(',') || csv.length < 40) {
            const msg = csv.trim() || 'Empty response';
            console.error(`FIRMS ${source}: non-CSV response:`, msg);
            throw new Error(`${source}: ${msg}`);
        }

        const data = FunMap.Utils.parseCSV(csv);

        // If headers were present but every row was skipped, the format may have changed
        if (data.length === 0 && csv.trim().split('\n').length > 1) {
            console.warn(`FIRMS ${source}: CSV had rows but none parsed. First 500 chars:`, csv.substring(0, 500));
        }

        // Tag each point with its source for the popup
        const sourceName = FunMap.Config.FIRMS.sources[source] || source;
        data.forEach(row => {
            if (!row.satellite) row.satellite = sourceName;
        });

        return data;
    },

    _renderData(data) {
        this._layerGroup.clearLayers();

        const colorBy = document.getElementById('firms-color').value;
        const maxPoints = FunMap.Config.Defaults.maxFirePoints;
        const toRender = data.slice(0, maxPoints);

        toRender.forEach(point => {
            const lat = parseFloat(point.latitude);
            const lng = parseFloat(point.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            let color;
            switch (colorBy) {
                case 'confidence':
                    color = FunMap.Utils.fireColor(point.confidence);
                    break;
                case 'frp':
                    color = FunMap.Utils.frpColor(point.frp);
                    break;
                case 'brightness':
                    color = FunMap.Utils.brightnessColor(point.bright_ti4 || point.brightness);
                    break;
                default:
                    color = '#ff6600';
            }

            const frp = parseFloat(point.frp) || 0;
            const radius = Math.max(3, Math.min(12, Math.sqrt(frp) * 0.8 + 3));

            const marker = L.circleMarker([lat, lng], {
                radius: radius,
                fillColor: color,
                color: color,
                weight: 1,
                opacity: 0.8,
                fillOpacity: 0.6,
            });

            const popupHtml = FunMap.Utils.popupTable('FIRE DETECTION', [
                ['Date', point.acq_date],
                ['Time (UTC)', point.acq_time],
                ['Satellite', point.satellite],
                ['Confidence', point.confidence],
                ['FRP (MW)', point.frp],
                ['Brightness', point.bright_ti4 || point.brightness],
                ['Day/Night', point.daynight === 'D' ? 'Day' : 'Night'],
                ['Location', FunMap.Utils.formatCoords(lat, lng, 5)],
            ]);
            marker.bindPopup(popupHtml);

            marker.on('click', () => {
                FunMap.Utils.showFeatureInfo('FIRE DETECTION', [
                    ['Date', point.acq_date],
                    ['Time', point.acq_time],
                    ['Satellite', point.satellite || '--'],
                    ['Confidence', point.confidence],
                    ['FRP (MW)', point.frp],
                    ['Brightness', point.bright_ti4 || point.brightness],
                    ['Scan', point.scan],
                    ['Track', point.track],
                    ['Lat', lat.toFixed(5)],
                    ['Lng', lng.toFixed(5)],
                ]);
            });

            this._layerGroup.addLayer(marker);
        });

        if (data.length > maxPoints) {
            FunMap.Utils.toast(`Showing ${maxPoints} of ${data.length} fire points. Zoom in for more detail.`, 'info');
        }
    },

    reload() {
        if (document.getElementById('layer-firms').checked) {
            this._loadData();
        }
    },
};
