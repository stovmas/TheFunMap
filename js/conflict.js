/* ============================================
   THE FUN MAP - Conflict Event Data
   ============================================ */

FunMap.Conflict = {
    _layerGroup: null,
    _data: [],
    _loading: false,
    _clusterGroup: null,

    init() {
        this._layerGroup = L.layerGroup();

        // Layer toggle
        document.getElementById('layer-conflict').addEventListener('change', (e) => {
            if (e.target.checked) {
                this._enable();
            } else {
                this._disable();
            }
            FunMap.Map.updateLayerCount();
            FunMap.UI.updateLegend();
        });

        // Source change
        document.getElementById('conflict-source').addEventListener('change', () => {
            if (document.getElementById('layer-conflict').checked) {
                this._loadData();
            }
        });

        // Type filter change
        document.getElementById('conflict-type').addEventListener('change', () => {
            if (this._data.length > 0) {
                this._renderData(this._filterData());
            }
        });

        // Min fatalities filter
        document.getElementById('conflict-min-fatal').addEventListener('change', () => {
            if (this._data.length > 0) {
                this._renderData(this._filterData());
            }
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

        const source = document.getElementById('conflict-source').value;

        try {
            if (source === 'ucdp') {
                await this._loadUCDP();
            } else if (source === 'acled') {
                await this._loadACLED();
            }
        } catch (err) {
            console.error('Conflict data error:', err);
            FunMap.Utils.toast('Conflict data: ' + err.message, 'error');
            FunMap.Utils.setStatus('CONFLICT DATA ERROR');
        }

        this._loading = false;
    },

    _getConflictDateRange() {
        return {
            from: document.getElementById('conflict-date-from').value,
            to: document.getElementById('conflict-date-to').value,
        };
    },

    async _loadUCDP() {
        FunMap.Utils.setStatus('LOADING UCDP DATA...');

        const dates = this._getConflictDateRange();
        const bounds = FunMap.Map.getBounds();
        let allResults = [];
        let page = 0;
        let totalPages = 1;
        const pageSize = 1000;

        // Build URL with filters
        let baseUrl = `${FunMap.Config.UCDP.endpoint}?pagesize=${pageSize}`;

        if (dates.from) baseUrl += `&StartDate=${dates.from}`;
        if (dates.to) baseUrl += `&EndDate=${dates.to}`;

        // Load pages (limit to 5 pages = 5000 events max)
        while (page < totalPages && page < 5) {
            const url = `${baseUrl}&page=${page}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`UCDP API error: ${response.status}`);

            const data = await response.json();
            totalPages = data.TotalPages || 1;
            allResults = allResults.concat(data.Result || []);
            page++;
        }

        // Normalize to common format
        this._data = allResults.map(event => ({
            id: event.id || event.event_id,
            date: event.date_start || event.date,
            lat: parseFloat(event.latitude),
            lng: parseFloat(event.longitude),
            type: this._ucdpTypeLabel(event.type_of_violence),
            typeKey: this._ucdpTypeKey(event.type_of_violence),
            fatalities: parseInt(event.best) || parseInt(event.deaths_total) || 0,
            description: event.source_article || event.event_description || '',
            sideA: event.side_a || '',
            sideB: event.side_b || '',
            country: event.country || '',
            region: event.region || '',
            source: 'UCDP',
            precision: event.where_prec || '',
            raw: event,
        })).filter(e => !isNaN(e.lat) && !isNaN(e.lng));

        // Filter by viewport
        const viewData = this._data.filter(e =>
            e.lat >= bounds.getSouth() && e.lat <= bounds.getNorth() &&
            e.lng >= bounds.getWest() && e.lng <= bounds.getEast()
        );

        const filtered = this._filterData(viewData);
        this._renderData(filtered);
        FunMap.Utils.setStatus(`${filtered.length} CONFLICT EVENTS LOADED (UCDP)`);

        if (this._data.length === 0) {
            FunMap.Utils.toast('No UCDP events found for this date range. UCDP data may have limited recent coverage.', 'info');
        }
    },

    _ucdpTypeLabel(type) {
        const types = {
            1: 'State-based Conflict',
            2: 'Non-state Conflict',
            3: 'One-sided Violence',
        };
        return types[type] || `Type ${type}`;
    },

    _ucdpTypeKey(type) {
        const keys = { 1: 'state-based', 2: 'non-state', 3: 'one-sided' };
        return keys[type] || 'state-based';
    },

    async _loadACLED() {
        const acledKey = FunMap.Settings.getApiKey('acled_key');
        const acledEmail = FunMap.Settings.getApiKey('acled_email');

        if (!acledKey || !acledEmail) {
            FunMap.Utils.toast('Configure ACLED API key and email in Settings', 'warning');
            this._loading = false;
            return;
        }

        FunMap.Utils.setStatus('LOADING ACLED DATA...');

        const dates = this._getConflictDateRange();
        const bounds = FunMap.Map.getBounds();

        let url = `${FunMap.Config.ACLED.endpoint}?key=${encodeURIComponent(acledKey)}&email=${encodeURIComponent(acledEmail)}&_format=json&limit=5000`;

        if (dates.from && dates.to) {
            url += `&event_date=${dates.from}|${dates.to}&event_date_where=BETWEEN`;
        } else if (dates.from) {
            url += `&event_date=${dates.from}&event_date_where=>=`;
        }

        // Geographic filter using bbox
        const bbox = FunMap.Utils.bboxFromBounds(bounds);
        url += `&latitude=${bbox[1]}|${bbox[3]}&latitude_where=BETWEEN`;
        url += `&longitude=${bbox[0]}|${bbox[2]}&longitude_where=BETWEEN`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`ACLED API error: ${response.status}`);

        const result = await response.json();
        const events = result.data || [];

        this._data = events.map(event => ({
            id: event.event_id_cnty || event.data_id,
            date: event.event_date,
            lat: parseFloat(event.latitude),
            lng: parseFloat(event.longitude),
            type: event.event_type,
            typeKey: this._acledTypeKey(event.event_type),
            subType: event.sub_event_type,
            fatalities: parseInt(event.fatalities) || 0,
            description: event.notes || '',
            sideA: event.actor1 || '',
            sideB: event.actor2 || '',
            country: event.country || '',
            region: event.admin1 || '',
            location: event.location || '',
            source: 'ACLED',
            precision: event.geo_precision,
            raw: event,
        })).filter(e => !isNaN(e.lat) && !isNaN(e.lng));

        const filtered = this._filterData();
        this._renderData(filtered);
        FunMap.Utils.setStatus(`${filtered.length} CONFLICT EVENTS LOADED (ACLED)`);
    },

    _acledTypeKey(type) {
        const map = {
            'Battles': 'battles',
            'Explosions/Remote violence': 'explosions',
            'Violence against civilians': 'violence_civilians',
            'Protests': 'protests',
            'Riots': 'riots',
            'Strategic developments': 'strategic',
        };
        return map[type] || 'battles';
    },

    _filterData(data) {
        data = data || this._data;
        const typeSelect = document.getElementById('conflict-type');
        const selectedTypes = Array.from(typeSelect.selectedOptions).map(o => o.value);
        const minFatal = parseInt(document.getElementById('conflict-min-fatal').value) || 0;
        const dates = this._getConflictDateRange();

        return data.filter(event => {
            // Date filter
            if (dates.from && event.date < dates.from) return false;
            if (dates.to && event.date > dates.to) return false;

            // Type filter
            if (!selectedTypes.includes('all')) {
                if (!selectedTypes.includes(event.typeKey)) return false;
            }

            // Fatalities filter
            if (event.fatalities < minFatal) return false;

            return true;
        });
    },

    _renderData(data) {
        this._layerGroup.clearLayers();

        const maxPoints = FunMap.Config.Defaults.maxConflictPoints;
        const toRender = data.slice(0, maxPoints);

        toRender.forEach(event => {
            const color = FunMap.Config.ConflictColors[event.typeKey] ||
                          FunMap.Config.ConflictColors[event.type] || '#ff3333';

            const size = Math.max(5, Math.min(16, Math.sqrt(event.fatalities + 1) * 3));

            const marker = L.circleMarker([event.lat, event.lng], {
                radius: size,
                fillColor: color,
                color: '#ffffff',
                weight: 1,
                opacity: 0.7,
                fillOpacity: 0.5,
            });

            const popupHtml = FunMap.Utils.popupTable('CONFLICT EVENT', [
                ['Date', event.date],
                ['Type', event.type],
                ['Sub-type', event.subType],
                ['Fatalities', event.fatalities],
                ['Side A', event.sideA],
                ['Side B', event.sideB],
                ['Country', event.country],
                ['Region', event.region || event.location],
                ['Source', event.source],
                ['Precision', event.precision],
                ['Location', FunMap.Utils.formatCoords(event.lat, event.lng, 5)],
            ]);
            marker.bindPopup(popupHtml, { maxWidth: 300 });

            marker.on('click', () => {
                FunMap.Utils.showFeatureInfo('CONFLICT EVENT', [
                    ['Date', event.date],
                    ['Type', event.type],
                    ['Sub-type', event.subType],
                    ['Fatalities', event.fatalities],
                    ['Side A', event.sideA],
                    ['Side B', event.sideB],
                    ['Country', event.country],
                    ['Source', event.source],
                ]);
            });

            // If there's a description, bind a tooltip
            if (event.description && event.description.length > 0) {
                marker.bindTooltip(event.description.substring(0, 120) + (event.description.length > 120 ? '...' : ''), {
                    direction: 'top',
                    className: 'conflict-tooltip',
                });
            }

            this._layerGroup.addLayer(marker);
        });

        if (data.length > maxPoints) {
            FunMap.Utils.toast(`Showing ${maxPoints} of ${data.length} conflict events. Apply filters to narrow results.`, 'info');
        }
    },

    reload() {
        if (document.getElementById('layer-conflict').checked) {
            this._loadData();
        }
    },
};
