/* ============================================
   THE FUN MAP - NASA FIRMS Fire Data
   ============================================ */

FunMap.FIRMS = {
    _layerGroup: null,
    _data: [],
    _loading: false,

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

        // Source/range/color changes
        ['firms-source', 'firms-range', 'firms-color'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                if (document.getElementById('layer-firms').checked) {
                    this._loadData();
                }
            });
        });
    },

    _enable() {
        this._layerGroup.addTo(FunMap.Map.map);
        this._loadData();
    },

    _disable() {
        FunMap.Map.map.removeLayer(this._layerGroup);
        this._layerGroup.clearLayers();
        this._data = [];
    },

    async _loadData() {
        if (this._loading) return;
        this._loading = true;

        const firmsKey = FunMap.Settings.getApiKey('firms_key');
        if (!firmsKey) {
            FunMap.Utils.toast('Configure NASA FIRMS MAP Key in Settings to load fire data', 'warning');
            this._loading = false;
            return;
        }

        const source = document.getElementById('firms-source').value;
        const range = document.getElementById('firms-range').value;
        const bounds = FunMap.Map.getBounds();
        const bbox = FunMap.Utils.bboxFromBounds(bounds);

        // Use bounding box for the current view
        const area = `${bbox[0].toFixed(2)},${bbox[1].toFixed(2)},${bbox[2].toFixed(2)},${bbox[3].toFixed(2)}`;

        const url = `${FunMap.Config.FIRMS.areaEndpoint}/csv/${firmsKey}/${source}/${area}/${range}`;

        FunMap.Utils.setStatus('LOADING FIRE DATA...');

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`FIRMS API error: ${response.status}`);
            }

            const csv = await response.text();
            this._data = FunMap.Utils.parseCSV(csv);

            // Apply date filter if set
            const dates = FunMap.UI.getDateRange();
            let filtered = this._data;
            if (dates.from || dates.to) {
                filtered = this._data.filter(d => {
                    const date = d.acq_date;
                    if (dates.from && date < dates.from) return false;
                    if (dates.to && date > dates.to) return false;
                    return true;
                });
            }

            this._renderData(filtered);
            FunMap.Utils.setStatus(`${filtered.length} FIRE DETECTIONS LOADED`);

            if (filtered.length === 0) {
                FunMap.Utils.toast('No fire detections found in this area/timeframe', 'info');
            }

        } catch (err) {
            console.error('FIRMS error:', err);
            FunMap.Utils.toast('FIRMS: ' + err.message, 'error');
            FunMap.Utils.setStatus('FIRMS ERROR');
        }

        this._loading = false;
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
                ['Satellite', point.satellite || FunMap.Config.FIRMS.sources[document.getElementById('firms-source').value]],
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

    // Called when date filter changes
    applyFilter() {
        if (!document.getElementById('layer-firms').checked) return;
        if (this._data.length === 0) return;

        const dates = FunMap.UI.getDateRange();
        let filtered = this._data;
        if (dates.from || dates.to) {
            filtered = this._data.filter(d => {
                const date = d.acq_date;
                if (dates.from && date < dates.from) return false;
                if (dates.to && date > dates.to) return false;
                return true;
            });
        }
        this._renderData(filtered);
    },

    reload() {
        if (document.getElementById('layer-firms').checked) {
            this._loadData();
        }
    },
};
