/* ============================================
   THE FUN MAP - Janus Eye: Area Monitoring
   ============================================ */

FunMap.Janus = {
    _monitors: [],
    _layerGroup: null,
    _drawMode: null,       // null, 'rectangle', 'polygon'
    _drawPoints: [],
    _drawLayers: null,
    _drawRect: null,
    _drawStartLatLng: null,
    _pendingGeometry: null, // geometry waiting for configuration
    _selectedMonitor: null, // ID of monitor open in changelog

    init() {
        this._layerGroup = L.layerGroup().addTo(FunMap.Map.map);
        this._drawLayers = L.layerGroup().addTo(FunMap.Map.map);
        this._monitors = this._loadFromStorage();

        // Drawing tool buttons
        document.getElementById('janus-draw-rect').addEventListener('click', () => this._startDraw('rectangle'));
        document.getElementById('janus-draw-poly').addEventListener('click', () => this._startDraw('polygon'));
        document.getElementById('janus-use-viewport').addEventListener('click', () => this._captureViewport());

        // Config modal
        document.getElementById('janus-config-cancel').addEventListener('click', () => this._closeConfig());
        document.getElementById('janus-config-save').addEventListener('click', () => this._saveMonitor());
        document.getElementById('janus-config-source').addEventListener('change', () => this._updateVizOptions());

        // Changelog modal
        document.getElementById('janus-changelog-close').addEventListener('click', () => this._closeChangelog());

        // X close buttons on modals
        document.getElementById('janus-config-cancel-x').addEventListener('click', () => this._closeConfig());

        // Close on overlay click
        document.getElementById('janus-config-dialog').addEventListener('click', (e) => {
            if (e.target.id === 'janus-config-dialog') this._closeConfig();
        });
        document.getElementById('janus-changelog-dialog').addEventListener('click', (e) => {
            if (e.target.id === 'janus-changelog-dialog') this._closeChangelog();
        });

        // Render stored monitors
        this._renderMonitorList();
        this._renderMonitorZones();

        // Check for due monitors on load
        setTimeout(() => this._checkDueMonitors(), 3000);
    },

    // ---- Storage ----

    _loadFromStorage() {
        try {
            const raw = localStorage.getItem('funmap_janus_monitors');
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    },

    _saveToStorage() {
        localStorage.setItem('funmap_janus_monitors', JSON.stringify(this._monitors));
    },

    // ---- Drawing: Rectangle ----

    _startDraw(mode) {
        // Cancel any active draw first
        this._cancelDraw();
        this._drawMode = mode;
        this._drawPoints = [];
        this._drawLayers.clearLayers();

        const container = FunMap.Map.map.getContainer();
        container.style.cursor = 'crosshair';

        // Disable map drag during rectangle drawing
        if (mode === 'rectangle') {
            FunMap.Map.map.dragging.disable();
            FunMap.Map.map.on('mousedown', this._onRectStart, this);
            FunMap.Utils.setStatus('JANUS EYE - CLICK AND DRAG TO DRAW RECTANGLE');
        } else if (mode === 'polygon') {
            FunMap.Map.map.on('click', this._onPolyClick, this);
            FunMap.Map.map.on('dblclick', this._onPolyFinish, this);
            FunMap.Utils.setStatus('JANUS EYE - CLICK TO ADD VERTICES, DOUBLE-CLICK TO FINISH');
        }

        FunMap.Utils.toast('Drawing mode active. Press ESC to cancel.', 'info', 3000);

        // ESC to cancel
        this._escHandler = (e) => { if (e.key === 'Escape') this._cancelDraw(); };
        document.addEventListener('keydown', this._escHandler);
    },

    _onRectStart(e) {
        this._drawStartLatLng = e.latlng;
        FunMap.Map.map.on('mousemove', this._onRectMove, this);
        FunMap.Map.map.on('mouseup', this._onRectEnd, this);
    },

    _onRectMove(e) {
        if (!this._drawStartLatLng) return;
        const bounds = L.latLngBounds(this._drawStartLatLng, e.latlng);
        if (this._drawRect) {
            this._drawRect.setBounds(bounds);
        } else {
            this._drawRect = L.rectangle(bounds, {
                color: '#87c540',
                weight: 2,
                fillColor: '#87c540',
                fillOpacity: 0.15,
                dashArray: '6,4',
            });
            this._drawLayers.addLayer(this._drawRect);
        }
    },

    _onRectEnd(e) {
        FunMap.Map.map.off('mousedown', this._onRectStart, this);
        FunMap.Map.map.off('mousemove', this._onRectMove, this);
        FunMap.Map.map.off('mouseup', this._onRectEnd, this);
        FunMap.Map.map.dragging.enable();

        if (!this._drawStartLatLng) return;

        const bounds = L.latLngBounds(this._drawStartLatLng, e.latlng);
        // Minimum size check
        const size = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
        if (size < 100) {
            this._cancelDraw();
            FunMap.Utils.toast('Area too small. Try again.', 'warning');
            return;
        }

        this._pendingGeometry = {
            type: 'rectangle',
            bounds: [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]],
        };
        this._finishDraw();
    },

    // ---- Drawing: Polygon ----

    _onPolyClick(e) {
        this._drawPoints.push(e.latlng);

        // Draw vertex marker
        const marker = L.circleMarker(e.latlng, {
            radius: 4, fillColor: '#87c540', color: '#fff', weight: 2, fillOpacity: 1,
        });
        this._drawLayers.addLayer(marker);

        // Draw connecting line
        if (this._drawPoints.length > 1) {
            const pts = this._drawPoints;
            const line = L.polyline([pts[pts.length - 2], pts[pts.length - 1]], {
                color: '#87c540', weight: 2, dashArray: '6,4',
            });
            this._drawLayers.addLayer(line);
        }
    },

    _onPolyFinish(e) {
        L.DomEvent.stopPropagation(e);
        if (this._drawPoints.length < 3) {
            FunMap.Utils.toast('Need at least 3 points for a polygon.', 'warning');
            return;
        }

        // Close the polygon visually
        const poly = L.polygon(this._drawPoints, {
            color: '#87c540', weight: 2, fillColor: '#87c540', fillOpacity: 0.15, dashArray: '6,4',
        });
        this._drawLayers.clearLayers();
        this._drawLayers.addLayer(poly);

        this._pendingGeometry = {
            type: 'polygon',
            coords: this._drawPoints.map(p => [p.lat, p.lng]),
        };
        this._finishDraw();
    },

    // ---- Viewport capture ----

    _captureViewport() {
        const bounds = FunMap.Map.map.getBounds();
        this._pendingGeometry = {
            type: 'viewport',
            bounds: [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]],
        };

        // Show the viewport outline briefly
        this._drawLayers.clearLayers();
        const rect = L.rectangle(bounds, {
            color: '#87c540', weight: 2, fillColor: '#87c540', fillOpacity: 0.1, dashArray: '6,4',
        });
        this._drawLayers.addLayer(rect);

        this._openConfig();
    },

    // ---- Finish drawing / open config ----

    _finishDraw() {
        const container = FunMap.Map.map.getContainer();
        container.style.cursor = '';
        FunMap.Map.map.off('click', this._onPolyClick, this);
        FunMap.Map.map.off('dblclick', this._onPolyFinish, this);
        FunMap.Map.map.off('mousedown', this._onRectStart, this);
        FunMap.Map.map.off('mousemove', this._onRectMove, this);
        FunMap.Map.map.off('mouseup', this._onRectEnd, this);
        if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
        this._drawMode = null;
        this._drawRect = null;
        this._drawStartLatLng = null;
        FunMap.Utils.setStatus('SYSTEMS ONLINE');

        this._openConfig();
    },

    _cancelDraw() {
        const container = FunMap.Map.map.getContainer();
        container.style.cursor = '';
        FunMap.Map.map.dragging.enable();
        FunMap.Map.map.off('mousedown', this._onRectStart, this);
        FunMap.Map.map.off('mousemove', this._onRectMove, this);
        FunMap.Map.map.off('mouseup', this._onRectEnd, this);
        FunMap.Map.map.off('click', this._onPolyClick, this);
        FunMap.Map.map.off('dblclick', this._onPolyFinish, this);
        if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
        this._drawLayers.clearLayers();
        this._drawMode = null;
        this._drawRect = null;
        this._drawStartLatLng = null;
        this._drawPoints = [];
        this._pendingGeometry = null;
        FunMap.Utils.setStatus('SYSTEMS ONLINE');
    },

    // ---- Config modal ----

    _openConfig(existingId) {
        const dialog = document.getElementById('janus-config-dialog');
        const titleEl = document.getElementById('janus-config-title');

        if (existingId) {
            const mon = this._monitors.find(m => m.id === existingId);
            if (!mon) return;
            titleEl.textContent = 'EDIT WATCH ZONE';
            document.getElementById('janus-config-name').value = mon.name;
            document.getElementById('janus-config-interval').value = mon.interval;
            document.getElementById('janus-config-source').value = mon.source;
            this._updateVizOptions();
            document.getElementById('janus-config-viz').value = mon.visualization;
            document.getElementById('janus-config-cva').checked = mon.includeCVA;
            dialog.dataset.editId = existingId;
        } else {
            titleEl.textContent = 'CONFIGURE WATCH ZONE';
            document.getElementById('janus-config-name').value = '';
            document.getElementById('janus-config-interval').value = 'weekly';
            document.getElementById('janus-config-source').value = 'sentinel2';
            this._updateVizOptions();
            document.getElementById('janus-config-cva').checked = false;
            delete dialog.dataset.editId;
        }

        dialog.classList.remove('hidden');
    },

    _closeConfig() {
        document.getElementById('janus-config-dialog').classList.add('hidden');
        // If user cancelled without saving, clear pending geometry and drawing
        if (!document.getElementById('janus-config-dialog').dataset.editId) {
            this._drawLayers.clearLayers();
            this._pendingGeometry = null;
        }
    },

    _updateVizOptions() {
        const source = document.getElementById('janus-config-source').value;
        const vizSelect = document.getElementById('janus-config-viz');
        vizSelect.innerHTML = '';

        const options = {
            sentinel2: [
                ['TRUE_COLOR', 'True Color RGB'],
                ['FALSE_COLOR', 'False Color (Vegetation)'],
                ['NDVI', 'NDVI'],
                ['NDWI', 'NDWI'],
            ],
            sentinel1: [
                ['VV', 'VV Polarization'],
                ['VH', 'VH Polarization'],
                ['VV_VH', 'VV/VH Ratio'],
            ],
            firms: [
                ['confidence', 'Confidence'],
                ['frp', 'Fire Radiative Power'],
                ['brightness', 'Brightness'],
            ],
            conflict: [
                ['all', 'All Event Types'],
                ['battles', 'Battles'],
                ['explosions', 'Explosions/Remote'],
                ['violence_civilians', 'Violence vs Civilians'],
            ],
        };

        (options[source] || options.sentinel2).forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            vizSelect.appendChild(opt);
        });

        // Show/hide CVA option (only for Sentinel sources)
        const cvaRow = document.getElementById('janus-config-cva-row');
        cvaRow.style.display = source.startsWith('sentinel') ? '' : 'none';
    },

    _saveMonitor() {
        const dialog = document.getElementById('janus-config-dialog');
        const name = document.getElementById('janus-config-name').value.trim();
        if (!name) {
            FunMap.Utils.toast('Enter a name for the watch zone.', 'warning');
            return;
        }

        const editId = dialog.dataset.editId;

        if (editId) {
            // Editing existing
            const mon = this._monitors.find(m => m.id === editId);
            if (!mon) return;
            mon.name = name;
            mon.interval = document.getElementById('janus-config-interval').value;
            mon.source = document.getElementById('janus-config-source').value;
            mon.visualization = document.getElementById('janus-config-viz').value;
            mon.includeCVA = document.getElementById('janus-config-cva').checked;
            mon.nextCheck = this._computeNextCheck(mon.interval, mon.lastCheck || mon.createdAt);
        } else {
            // Creating new
            if (!this._pendingGeometry) {
                FunMap.Utils.toast('No area selected. Draw an area first.', 'error');
                return;
            }

            const now = new Date().toISOString();
            const interval = document.getElementById('janus-config-interval').value;
            const monitor = {
                id: FunMap.Utils.uid(),
                name: name,
                geometry: this._pendingGeometry,
                interval: interval,
                source: document.getElementById('janus-config-source').value,
                visualization: document.getElementById('janus-config-viz').value,
                includeCVA: document.getElementById('janus-config-cva').checked,
                createdAt: now,
                lastCheck: null,
                nextCheck: this._computeNextCheck(interval, now),
                changelog: [],
            };

            this._monitors.push(monitor);
            this._pendingGeometry = null;
        }

        this._saveToStorage();
        this._drawLayers.clearLayers();
        dialog.classList.add('hidden');
        this._renderMonitorList();
        this._renderMonitorZones();
        FunMap.Utils.toast('Watch zone saved.', 'success');
    },

    // ---- Interval helpers ----

    _computeNextCheck(interval, fromDateStr) {
        const d = new Date(fromDateStr);
        switch (interval) {
            case 'daily': d.setDate(d.getDate() + 1); break;
            case 'weekly': d.setDate(d.getDate() + 7); break;
            case 'biweekly': d.setDate(d.getDate() + 14); break;
            case 'monthly': d.setMonth(d.getMonth() + 1); break;
            case 'quarterly': d.setMonth(d.getMonth() + 3); break;
            default: d.setDate(d.getDate() + 7);
        }
        return d.toISOString();
    },

    _intervalLabel(interval) {
        const labels = {
            daily: 'Daily', weekly: 'Weekly', biweekly: 'Bi-Weekly',
            monthly: 'Monthly', quarterly: 'Quarterly',
        };
        return labels[interval] || interval;
    },

    _sourceLabel(source) {
        const labels = {
            sentinel2: 'Sentinel-2', sentinel1: 'Sentinel-1 SAR',
            firms: 'NASA FIRMS', conflict: 'Conflict Events',
        };
        return labels[source] || source;
    },

    _isDue(monitor) {
        if (!monitor.nextCheck) return true;
        return new Date() >= new Date(monitor.nextCheck);
    },

    // ---- Sidebar monitor list ----

    _renderMonitorList() {
        const list = document.getElementById('janus-monitor-list');
        if (this._monitors.length === 0) {
            list.innerHTML = '<div class="empty-state">No watch zones. Use the tools above to select an area.</div>';
            return;
        }

        let html = '';
        this._monitors.forEach(mon => {
            const due = this._isDue(mon);
            const dueClass = due ? 'janus-due' : '';
            const changeCount = mon.changelog.length;
            const lastChange = changeCount > 0 ? FunMap.Utils.formatDate(mon.changelog[0].date) : 'Never';

            html += `<div class="janus-monitor-item ${dueClass}" data-id="${mon.id}">
                <div class="janus-monitor-header">
                    <span class="janus-monitor-name">${mon.name}</span>
                    <span class="janus-monitor-badge">${this._intervalLabel(mon.interval)}</span>
                </div>
                <div class="janus-monitor-meta">
                    <span>${this._sourceLabel(mon.source)}</span>
                    <span>|</span>
                    <span>${changeCount} report${changeCount !== 1 ? 's' : ''}</span>
                    <span>|</span>
                    <span>Last: ${lastChange}</span>
                </div>
                <div class="janus-monitor-actions">
                    <button class="xbox-btn xs janus-btn-check" data-id="${mon.id}" title="Run check now"${due ? ' style="border-color:var(--xbox-orange);color:var(--xbox-orange)"' : ''}>
                        ${due ? 'CHECK (DUE)' : 'CHECK NOW'}
                    </button>
                    <button class="xbox-btn xs janus-btn-log" data-id="${mon.id}" title="View changelog">LOG</button>
                    <button class="xbox-btn xs janus-btn-fly" data-id="${mon.id}" title="Fly to zone">FLY TO</button>
                    <button class="xbox-btn xs ghost janus-btn-edit" data-id="${mon.id}" title="Edit">EDIT</button>
                    <button class="xbox-btn xs ghost accent janus-btn-delete" data-id="${mon.id}" title="Delete">DEL</button>
                </div>
            </div>`;
        });

        list.innerHTML = html;

        // Wire up action buttons
        list.querySelectorAll('.janus-btn-check').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._runCheck(btn.dataset.id);
            });
        });
        list.querySelectorAll('.janus-btn-log').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._openChangelog(btn.dataset.id);
            });
        });
        list.querySelectorAll('.janus-btn-fly').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._flyToMonitor(btn.dataset.id);
            });
        });
        list.querySelectorAll('.janus-btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._openConfig(btn.dataset.id);
            });
        });
        list.querySelectorAll('.janus-btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._deleteMonitor(btn.dataset.id);
            });
        });
    },

    // ---- Render zone outlines on map ----

    _renderMonitorZones() {
        this._layerGroup.clearLayers();

        this._monitors.forEach(mon => {
            const geom = mon.geometry;
            let shape;

            if (geom.type === 'rectangle' || geom.type === 'viewport') {
                shape = L.rectangle(geom.bounds, {
                    color: '#87c540',
                    weight: 1.5,
                    fillColor: '#87c540',
                    fillOpacity: 0.04,
                    dashArray: '8,4',
                    interactive: true,
                });
            } else if (geom.type === 'polygon') {
                shape = L.polygon(geom.coords, {
                    color: '#87c540',
                    weight: 1.5,
                    fillColor: '#87c540',
                    fillOpacity: 0.04,
                    dashArray: '8,4',
                    interactive: true,
                });
            }

            if (shape) {
                shape.bindTooltip(`<b>${mon.name}</b><br>${this._intervalLabel(mon.interval)} | ${this._sourceLabel(mon.source)}`, {
                    className: 'conflict-tooltip',
                    direction: 'top',
                });
                shape.on('click', () => this._openChangelog(mon.id));
                this._layerGroup.addLayer(shape);
            }
        });
    },

    // ---- Fly to monitor ----

    _flyToMonitor(id) {
        const mon = this._monitors.find(m => m.id === id);
        if (!mon) return;
        const geom = mon.geometry;

        if (geom.type === 'rectangle' || geom.type === 'viewport') {
            FunMap.Map.map.fitBounds(geom.bounds, { padding: [40, 40] });
        } else if (geom.type === 'polygon') {
            const layer = L.polygon(geom.coords);
            FunMap.Map.map.fitBounds(layer.getBounds(), { padding: [40, 40] });
        }
    },

    // ---- Delete monitor ----

    _deleteMonitor(id) {
        this._monitors = this._monitors.filter(m => m.id !== id);
        this._saveToStorage();
        this._renderMonitorList();
        this._renderMonitorZones();
        FunMap.Utils.toast('Watch zone deleted.', 'success');
    },

    // ---- Run check ----

    async _runCheck(id) {
        const mon = this._monitors.find(m => m.id === id);
        if (!mon) return;

        FunMap.Utils.setStatus(`JANUS EYE - CHECKING "${mon.name.toUpperCase()}"...`);

        const now = new Date();
        const prevDate = mon.lastCheck || mon.createdAt;
        const prevDateStr = FunMap.Utils.toISODate(new Date(prevDate));
        const nowStr = FunMap.Utils.toISODate(now);

        // Build the bounds for the area
        let bounds;
        if (mon.geometry.type === 'polygon') {
            bounds = L.polygon(mon.geometry.coords).getBounds();
        } else {
            bounds = L.latLngBounds(mon.geometry.bounds[0], mon.geometry.bounds[1]);
        }
        const bbox = FunMap.Utils.bboxFromBounds(bounds);

        let summary = '';
        let details = {};
        let changeDetected = false;

        try {
            if (mon.source === 'firms') {
                const result = await this._checkFIRMS(bbox, prevDateStr, nowStr);
                summary = result.summary;
                details = result.details;
                changeDetected = result.changeDetected;
            } else if (mon.source === 'conflict') {
                const result = await this._checkConflict(bbox, prevDateStr, nowStr);
                summary = result.summary;
                details = result.details;
                changeDetected = result.changeDetected;
            } else if (mon.source === 'sentinel2' || mon.source === 'sentinel1') {
                const result = await this._checkSentinel(mon, bbox, prevDateStr, nowStr);
                summary = result.summary;
                details = result.details;
                changeDetected = result.changeDetected;
            }
        } catch (err) {
            summary = 'Check failed: ' + err.message;
            details = { error: err.message };
        }

        // Add changelog entry (newest first)
        const entry = {
            id: FunMap.Utils.uid(),
            date: now.toISOString(),
            rangeFrom: prevDateStr,
            rangeTo: nowStr,
            summary: summary,
            changeDetected: changeDetected,
            details: details,
        };

        mon.changelog.unshift(entry);
        mon.lastCheck = now.toISOString();
        mon.nextCheck = this._computeNextCheck(mon.interval, now.toISOString());

        this._saveToStorage();
        this._renderMonitorList();

        FunMap.Utils.setStatus('SYSTEMS ONLINE');
        if (changeDetected) {
            FunMap.Utils.toast(`"${mon.name}" - Change detected!`, 'warning', 5000);
        } else {
            FunMap.Utils.toast(`"${mon.name}" - Check complete. No significant change.`, 'success');
        }
    },

    // ---- FIRMS check ----

    async _checkFIRMS(bbox, fromDate, toDate) {
        const apiKey = FunMap.Settings.getApiKey('firms_key');
        if (!apiKey) {
            return { summary: 'No FIRMS API key configured.', details: {}, changeDetected: false };
        }

        const dayRange = Math.min(10, Math.max(1, Math.ceil((new Date(toDate) - new Date(fromDate)) / 86400000)));
        const source = 'VIIRS_SNPP_NRT';
        const area = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;
        const url = `${FunMap.Config.FIRMS.areaEndpoint}/csv/${apiKey}/${source}/world/${dayRange}/${area}`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('FIRMS API error: ' + resp.status);
        const csv = await resp.text();
        const rows = FunMap.Utils.parseCSV(csv);

        const fireCount = rows.length;
        const highConf = rows.filter(r => r.confidence === 'high' || r.confidence === 'h' || parseFloat(r.confidence) >= 80).length;
        const avgFRP = rows.length > 0 ? (rows.reduce((s, r) => s + (parseFloat(r.frp) || 0), 0) / rows.length).toFixed(1) : 0;

        return {
            summary: fireCount > 0
                ? `${fireCount} fire detection${fireCount !== 1 ? 's' : ''} (${highConf} high confidence). Average FRP: ${avgFRP} MW.`
                : 'No fire detections in this period.',
            details: { fireCount, highConf, avgFRP, dayRange },
            changeDetected: fireCount > 0,
        };
    },

    // ---- Conflict check ----

    async _checkConflict(bbox, fromDate, toDate) {
        // Use UCDP (no key required)
        const url = `${FunMap.Config.UCDP.endpoint}?pagesize=100&StartDate=${fromDate}&EndDate=${toDate}` +
            `&Latitude=${(bbox[1] + bbox[3]) / 2}&Longitude=${(bbox[0] + bbox[2]) / 2}&Distance=500`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('UCDP API error: ' + resp.status);
        const data = await resp.json();
        const results = data.Result || [];

        // Filter to our bbox
        const inBbox = results.filter(ev => {
            const lat = parseFloat(ev.latitude);
            const lng = parseFloat(ev.longitude);
            return lat >= bbox[1] && lat <= bbox[3] && lng >= bbox[0] && lng <= bbox[2];
        });

        const totalFatal = inBbox.reduce((s, ev) => s + (parseInt(ev.best) || 0), 0);

        return {
            summary: inBbox.length > 0
                ? `${inBbox.length} conflict event${inBbox.length !== 1 ? 's' : ''} detected. Total fatalities: ${totalFatal}.`
                : 'No conflict events in this period.',
            details: { eventCount: inBbox.length, totalFatal },
            changeDetected: inBbox.length > 0,
        };
    },

    // ---- Sentinel check ----

    async _checkSentinel(monitor, bbox, fromDate, toDate) {
        const token = await FunMap.Settings.getCDSEToken();
        if (!token) {
            return { summary: 'No CDSE credentials configured.', details: {}, changeDetected: false };
        }

        const collectionId = monitor.source === 'sentinel1'
            ? 'sentinel-1-grd'
            : 'sentinel-2-l2a';

        // Search catalog for available imagery
        const searchBody = {
            bbox: bbox,
            datetime: `${fromDate}T00:00:00Z/${toDate}T23:59:59Z`,
            collections: [collectionId],
            limit: 20,
        };

        if (monitor.source === 'sentinel2') {
            searchBody.filter = {
                op: '<=',
                args: [{ property: 'eo:cloud_cover' }, 40],
            };
        }

        const catalogResp = await fetch(FunMap.Config.CDSE.catalogEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(searchBody),
        });

        if (!catalogResp.ok) throw new Error('Catalog search failed: ' + catalogResp.status);
        const catalogData = await catalogResp.json();
        const features = catalogData.features || [];

        const imgCount = features.length;
        let cvaNote = '';

        if (monitor.includeCVA && imgCount >= 2) {
            cvaNote = ' CVA analysis available — open the zone changelog to compare images.';
        }

        if (imgCount === 0) {
            return {
                summary: `No ${monitor.source === 'sentinel1' ? 'SAR' : 'optical'} imagery available for this period and area.`,
                details: { imgCount },
                changeDetected: false,
            };
        }

        // Summarize dates
        const dates = features.map(f => f.properties.datetime.split('T')[0]);
        const uniqueDates = [...new Set(dates)];

        return {
            summary: `${imgCount} ${monitor.source === 'sentinel1' ? 'SAR' : 'optical'} image${imgCount !== 1 ? 's' : ''} available across ${uniqueDates.length} date${uniqueDates.length !== 1 ? 's' : ''} (${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}).${cvaNote}`,
            details: { imgCount, dates: uniqueDates },
            changeDetected: imgCount > 0,
        };
    },

    // ---- Changelog modal ----

    _openChangelog(id) {
        const mon = this._monitors.find(m => m.id === id);
        if (!mon) return;

        this._selectedMonitor = id;
        document.getElementById('janus-changelog-title').textContent = mon.name;

        const body = document.getElementById('janus-changelog-body');

        if (mon.changelog.length === 0) {
            body.innerHTML = '<div class="empty-state">No reports yet. Run a check to generate the first report.</div>';
        } else {
            let html = '';
            mon.changelog.forEach(entry => {
                const changeClass = entry.changeDetected ? 'janus-change-yes' : 'janus-change-no';
                const changeIcon = entry.changeDetected ? '!' : '-';
                html += `<div class="janus-changelog-entry ${changeClass}">
                    <div class="janus-changelog-date">
                        <span class="janus-changelog-icon">${changeIcon}</span>
                        <span>${FunMap.Utils.formatDate(entry.date)}</span>
                        <span class="janus-changelog-range">${entry.rangeFrom} to ${entry.rangeTo}</span>
                    </div>
                    <div class="janus-changelog-summary">${entry.summary}</div>
                    ${entry.details && Object.keys(entry.details).length > 0 ? `
                    <div class="janus-changelog-details">
                        ${Object.entries(entry.details).map(([k, v]) =>
                            `<span class="janus-detail-tag">${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}</span>`
                        ).join('')}
                    </div>` : ''}
                </div>`;
            });
            body.innerHTML = html;
        }

        document.getElementById('janus-changelog-dialog').classList.remove('hidden');
    },

    _closeChangelog() {
        document.getElementById('janus-changelog-dialog').classList.add('hidden');
        this._selectedMonitor = null;
    },

    // ---- Auto-check due monitors ----

    _checkDueMonitors() {
        const due = this._monitors.filter(m => this._isDue(m));
        if (due.length > 0) {
            FunMap.Utils.toast(
                `Janus Eye: ${due.length} watch zone${due.length !== 1 ? 's' : ''} overdue for check.`,
                'warning',
                6000
            );
        }
    },
};
