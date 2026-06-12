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
    _pendingGeometry: null,    // geometry waiting for configuration
    _suppressZoneClick: false, // ignore zone clicks right after finishing a draw
    _cvaOverlay: null,         // active CVA overlay on the main map
    _cvaOverlayEntry: null,    // changelog entry id the overlay belongs to
    _cvaOverlayMon: null,      // monitor id the overlay belongs to

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
        document.getElementById('janus-config-cancel-x').addEventListener('click', () => this._closeConfig());

        // Changelog modal
        document.getElementById('janus-changelog-close').addEventListener('click', () => this._closeChangelog());

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

        // Auto-run due monitors shortly after boot
        setTimeout(() => this._checkDueMonitors(), 5000);
    },

    // ---- Storage ----

    _loadFromStorage() {
        try {
            const raw = localStorage.getItem('funmap_janus_monitors');
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    },

    _saveToStorage() {
        try {
            localStorage.setItem('funmap_janus_monitors', JSON.stringify(this._monitors));
        } catch (err) {
            // Likely quota exceeded — strip stored CVA images and retry
            this._monitors.forEach(m => m.changelog.forEach(e => { delete e.cvaImage; }));
            try {
                localStorage.setItem('funmap_janus_monitors', JSON.stringify(this._monitors));
                FunMap.Utils.toast('Storage full — older CVA snapshots were discarded.', 'warning');
            } catch (err2) {
                FunMap.Utils.toast('Could not save watch zones: ' + err2.message, 'error');
            }
        }
    },

    // ---- Drawing ----

    _startDraw(mode) {
        // Cancel any active draw first
        this._cancelDraw();
        this._drawMode = mode;
        this._drawPoints = [];
        this._drawLayers.clearLayers();

        const map = FunMap.Map.map;
        map.getContainer().style.cursor = 'crosshair';
        map.doubleClickZoom.disable();

        if (mode === 'rectangle') {
            map.dragging.disable();
            map.on('mousedown', this._onRectStart, this);
            FunMap.Utils.setStatus('JANUS EYE - CLICK AND DRAG TO DRAW RECTANGLE');
        } else if (mode === 'polygon') {
            map.on('click', this._onPolyClick, this);
            map.on('dblclick', this._onPolyFinish, this);
            FunMap.Utils.setStatus('JANUS EYE - CLICK TO ADD VERTICES, DOUBLE-CLICK TO FINISH');
        }

        FunMap.Utils.toast('Drawing mode active. Press ESC to cancel.', 'info', 3000);

        this._escHandler = (e) => { if (e.key === 'Escape') this._cancelDraw(); };
        document.addEventListener('keydown', this._escHandler);
    },

    // ---- Drawing: Rectangle ----

    _onRectStart(e) {
        // Left button only — right-click is pin placement
        if (e.originalEvent && e.originalEvent.button !== 0) return;
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
                interactive: false,
            });
            this._drawLayers.addLayer(this._drawRect);
        }
    },

    _onRectEnd(e) {
        FunMap.Map.map.off('mousemove', this._onRectMove, this);
        FunMap.Map.map.off('mouseup', this._onRectEnd, this);

        if (!this._drawStartLatLng) { this._cancelDraw(); return; }

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

        const marker = L.circleMarker(e.latlng, {
            radius: 4, fillColor: '#87c540', color: '#fff', weight: 2, fillOpacity: 1,
            interactive: false,
        });
        this._drawLayers.addLayer(marker);

        if (this._drawPoints.length > 1) {
            const pts = this._drawPoints;
            const line = L.polyline([pts[pts.length - 2], pts[pts.length - 1]], {
                color: '#87c540', weight: 2, dashArray: '6,4', interactive: false,
            });
            this._drawLayers.addLayer(line);
        }
    },

    _onPolyFinish(e) {
        L.DomEvent.stop(e);

        // The double-click fires two click events first — strip duplicate
        // trailing vertices that landed on (nearly) the same spot
        const map = FunMap.Map.map;
        const pts = this._drawPoints;
        while (pts.length > 3) {
            const a = map.latLngToContainerPoint(pts[pts.length - 1]);
            const b = map.latLngToContainerPoint(pts[pts.length - 2]);
            if (a.distanceTo(b) < 10) pts.pop(); else break;
        }

        if (pts.length < 3) {
            FunMap.Utils.toast('Need at least 3 points for a polygon.', 'warning');
            return;
        }

        const poly = L.polygon(pts, {
            color: '#87c540', weight: 2, fillColor: '#87c540', fillOpacity: 0.15,
            dashArray: '6,4', interactive: false,
        });
        this._drawLayers.clearLayers();
        this._drawLayers.addLayer(poly);

        this._pendingGeometry = {
            type: 'polygon',
            coords: pts.map(p => [p.lat, p.lng]),
        };
        this._finishDraw();
    },

    // ---- Viewport capture ----

    _captureViewport() {
        // Cancel any active draw so its handlers don't linger
        this._cancelDraw();

        const bounds = FunMap.Map.map.getBounds();
        this._pendingGeometry = {
            type: 'viewport',
            bounds: [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]],
        };

        const rect = L.rectangle(bounds, {
            color: '#87c540', weight: 2, fillColor: '#87c540', fillOpacity: 0.1,
            dashArray: '6,4', interactive: false,
        });
        this._drawLayers.addLayer(rect);

        this._openConfig();
    },

    // ---- Finish / cancel drawing ----

    _teardownDrawHandlers() {
        const map = FunMap.Map.map;
        map.getContainer().style.cursor = '';
        map.dragging.enable();
        map.doubleClickZoom.enable();
        map.off('mousedown', this._onRectStart, this);
        map.off('mousemove', this._onRectMove, this);
        map.off('mouseup', this._onRectEnd, this);
        map.off('click', this._onPolyClick, this);
        map.off('dblclick', this._onPolyFinish, this);
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        this._drawMode = null;
        this._drawRect = null;
        this._drawStartLatLng = null;
    },

    _finishDraw() {
        this._teardownDrawHandlers();
        // Briefly ignore zone-shape clicks fired by the same gesture
        this._suppressZoneClick = true;
        setTimeout(() => { this._suppressZoneClick = false; }, 300);
        FunMap.Utils.setStatus('SYSTEMS ONLINE');
        this._openConfig();
    },

    _cancelDraw() {
        this._teardownDrawHandlers();
        this._drawLayers.clearLayers();
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
        const dialog = document.getElementById('janus-config-dialog');
        dialog.classList.add('hidden');
        // If user cancelled a new zone (not an edit), discard the drawn area
        if (!dialog.dataset.editId) {
            this._drawLayers.clearLayers();
            this._pendingGeometry = null;
        }
        delete dialog.dataset.editId;
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

        // CVA is only meaningful for Sentinel sources
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
            const mon = this._monitors.find(m => m.id === editId);
            if (!mon) return;
            mon.name = name;
            mon.interval = document.getElementById('janus-config-interval').value;
            mon.source = document.getElementById('janus-config-source').value;
            mon.visualization = document.getElementById('janus-config-viz').value;
            mon.includeCVA = document.getElementById('janus-config-cva').checked;
            mon.nextCheck = this._computeNextCheck(mon.interval, mon.lastCheck || mon.createdAt);
        } else {
            if (!this._pendingGeometry) {
                FunMap.Utils.toast('No area selected. Draw an area first.', 'error');
                return;
            }

            const now = new Date().toISOString();
            const interval = document.getElementById('janus-config-interval').value;
            this._monitors.push({
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
            });
            this._pendingGeometry = null;
        }

        delete dialog.dataset.editId;
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

    _monitorBounds(mon) {
        if (mon.geometry.type === 'polygon') {
            return L.polygon(mon.geometry.coords).getBounds();
        }
        return L.latLngBounds(mon.geometry.bounds[0], mon.geometry.bounds[1]);
    },

    _credsAvailable(mon) {
        if (mon.source === 'firms') return !!FunMap.Settings.getApiKey('firms_key');
        if (mon.source === 'conflict') return true; // UCDP needs no key
        return !!FunMap.Settings.getApiKey('cdse_client_id') &&
               !!FunMap.Settings.getApiKey('cdse_client_secret');
    },

    // ---- Sidebar monitor list ----

    _renderMonitorList() {
        const list = document.getElementById('janus-monitor-list');
        if (this._monitors.length === 0) {
            list.innerHTML = '<div class="empty-state">No watch zones. Use the tools above to select an area.</div>';
            return;
        }

        const esc = FunMap.Utils.escapeHtml;
        let html = '';
        this._monitors.forEach(mon => {
            const due = this._isDue(mon);
            const dueClass = due ? 'janus-due' : '';
            const changeCount = mon.changelog.length;
            const lastChange = changeCount > 0 ? FunMap.Utils.formatDate(mon.changelog[0].date) : 'Never';

            html += `<div class="janus-monitor-item ${dueClass}" data-id="${mon.id}">
                <div class="janus-monitor-header">
                    <span class="janus-monitor-name">${esc(mon.name)}</span>
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

        const wire = (cls, fn) => {
            list.querySelectorAll(cls).forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    fn(btn.dataset.id);
                });
            });
        };
        wire('.janus-btn-check', id => this._runCheck(id));
        wire('.janus-btn-log', id => this._openChangelog(id));
        wire('.janus-btn-fly', id => this._flyToMonitor(id));
        wire('.janus-btn-edit', id => this._openConfig(id));
        wire('.janus-btn-delete', id => this._deleteMonitor(id));
    },

    // ---- Render zone outlines on map ----

    _renderMonitorZones() {
        this._layerGroup.clearLayers();
        const esc = FunMap.Utils.escapeHtml;

        this._monitors.forEach(mon => {
            const geom = mon.geometry;
            const style = {
                color: '#87c540',
                weight: 1.5,
                fillColor: '#87c540',
                fillOpacity: 0.04,
                dashArray: '8,4',
            };
            let shape;
            if (geom.type === 'rectangle' || geom.type === 'viewport') {
                shape = L.rectangle(geom.bounds, style);
            } else if (geom.type === 'polygon') {
                shape = L.polygon(geom.coords, style);
            }

            if (shape) {
                shape.bindTooltip(`<b>${esc(mon.name)}</b><br>${this._intervalLabel(mon.interval)} | ${this._sourceLabel(mon.source)}`, {
                    className: 'conflict-tooltip',
                    direction: 'top',
                });
                shape.on('click', () => {
                    if (this._drawMode || this._suppressZoneClick) return;
                    this._openChangelog(mon.id);
                });
                this._layerGroup.addLayer(shape);
            }
        });
    },

    _flyToMonitor(id) {
        const mon = this._monitors.find(m => m.id === id);
        if (!mon) return;
        FunMap.Map.map.fitBounds(this._monitorBounds(mon), { padding: [40, 40] });
    },

    _deleteMonitor(id) {
        this._monitors = this._monitors.filter(m => m.id !== id);
        if (this._cvaOverlayMon === id) this._removeCVAOverlay();
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

        const bounds = this._monitorBounds(mon);
        const bbox = FunMap.Utils.bboxFromBounds(bounds);

        let result = { summary: '', details: {}, changeDetected: false };

        try {
            if (mon.source === 'firms') {
                result = await this._checkFIRMS(bbox, prevDateStr, nowStr);
            } else if (mon.source === 'conflict') {
                result = await this._checkConflict(bbox, prevDateStr, nowStr);
            } else if (mon.source === 'sentinel2' || mon.source === 'sentinel1') {
                result = await this._checkSentinel(mon, bbox, prevDateStr, nowStr);
            }
        } catch (err) {
            result = {
                summary: 'Check failed: ' + err.message,
                details: { error: err.message },
                changeDetected: false,
            };
        }

        const entry = {
            id: FunMap.Utils.uid(),
            date: now.toISOString(),
            rangeFrom: prevDateStr,
            rangeTo: nowStr,
            summary: result.summary,
            changeDetected: result.changeDetected,
            details: result.details,
        };
        if (result.cvaImage) entry.cvaImage = result.cvaImage;

        mon.changelog.unshift(entry);
        // Keep only the 2 newest stored CVA snapshots per monitor, cap log at 50
        mon.changelog.slice(2).forEach(e => { delete e.cvaImage; });
        if (mon.changelog.length > 50) mon.changelog.length = 50;

        mon.lastCheck = now.toISOString();
        mon.nextCheck = this._computeNextCheck(mon.interval, now.toISOString());

        this._saveToStorage();
        this._renderMonitorList();

        FunMap.Utils.setStatus('SYSTEMS ONLINE');
        if (result.changeDetected) {
            FunMap.Utils.toast(`"${mon.name}" - Change detected!`, 'warning', 5000);
        } else {
            FunMap.Utils.toast(`"${mon.name}" - Check logged.`, 'success');
        }
    },

    // ---- FIRMS check ----

    async _checkFIRMS(bbox, fromDate, toDate) {
        const apiKey = FunMap.Settings.getApiKey('firms_key');
        if (!apiKey) {
            return { summary: 'No FIRMS API key configured. Add one in Settings > API Keys.', details: {}, changeDetected: false };
        }

        // FIRMS day range counts back from today and is capped at 10 days
        const periodDays = Math.max(1, Math.ceil((new Date(toDate) - new Date(fromDate)) / 86400000));
        const dayRange = Math.min(10, periodDays);

        // Clamp bbox to valid geographic ranges
        const west = Math.max(-180, bbox[0]);
        const south = Math.max(-90, bbox[1]);
        const east = Math.min(180, bbox[2]);
        const north = Math.min(90, bbox[3]);
        const area = `${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}`;

        const source = 'VIIRS_SNPP_NRT';
        const url = `${FunMap.Config.FIRMS.areaEndpoint}/csv/${apiKey}/${source}/${area}/${dayRange}`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('FIRMS API error: ' + resp.status);
        const csv = await resp.text();

        // FIRMS returns error messages as plain text with 200 status
        if (!csv.includes(',') || csv.length < 40) {
            throw new Error(csv.trim() || 'Empty response from FIRMS');
        }
        const rows = FunMap.Utils.parseCSV(csv);

        const fireCount = rows.length;
        const highConf = rows.filter(r => r.confidence === 'high' || r.confidence === 'h' || parseFloat(r.confidence) >= 80).length;
        const avgFRP = rows.length > 0 ? (rows.reduce((s, r) => s + (parseFloat(r.frp) || 0), 0) / rows.length).toFixed(1) : 0;
        const truncated = periodDays > 10 ? ' (FIRMS limits queries to the most recent 10 days)' : '';

        return {
            summary: fireCount > 0
                ? `${fireCount} fire detection${fireCount !== 1 ? 's' : ''} (${highConf} high confidence). Average FRP: ${avgFRP} MW.${truncated}`
                : `No fire detections in this period.${truncated}`,
            details: { fireCount, highConf, avgFRP, dayRange },
            changeDetected: fireCount > 0,
        };
    },

    // ---- Conflict check (UCDP, no key required) ----

    async _checkConflict(bbox, fromDate, toDate) {
        const url = `${FunMap.Config.UCDP.endpoint}?pagesize=1000&StartDate=${fromDate}&EndDate=${toDate}&page=0`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('UCDP API error: ' + resp.status);
        const data = await resp.json();
        const results = data.Result || [];

        // Filter to the zone bbox client-side
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
        let token;
        try {
            token = await FunMap.Settings.getCDSEToken();
        } catch (err) {
            return { summary: err.message, details: {}, changeDetected: false };
        }

        const isS1 = monitor.source === 'sentinel1';
        const collectionId = isS1 ? 'sentinel-1-grd' : 'sentinel-2-l2a';

        // Search the catalog using the same request shape as the working
        // date-availability fetch (no server-side filter — CDSE rejects
        // unexpected filter syntax; cloud filter is applied client-side)
        const fieldsInclude = ['properties.datetime'];
        if (!isS1) fieldsInclude.push('properties.eo:cloud_cover');

        const searchBody = {
            bbox: bbox,
            datetime: `${fromDate}T00:00:00Z/${toDate}T23:59:59Z`,
            collections: [collectionId],
            limit: 100,
            fields: { include: fieldsInclude },
        };

        const catalogResp = await fetch(FunMap.Config.CDSE.catalogEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(searchBody),
        });

        if (!catalogResp.ok) throw new Error('Catalog search failed: ' + catalogResp.status);
        const catalogData = await catalogResp.json();
        let features = catalogData.features || [];

        // Client-side cloud filter for S2
        if (!isS1) {
            features = features.filter(f => {
                const cc = f.properties && f.properties['eo:cloud_cover'];
                return cc === undefined || cc === null || cc <= 40;
            });
        }

        const imgCount = features.length;
        const kind = isS1 ? 'SAR' : 'optical';

        if (imgCount === 0) {
            return {
                summary: `No usable ${kind} imagery for this period and area${isS1 ? '' : ' (under 40% cloud cover)'}.`,
                details: { imgCount: 0 },
                changeDetected: false,
            };
        }

        const dates = [...new Set(features.map(f => f.properties.datetime.split('T')[0]))].sort();
        let summary = `${imgCount} ${kind} image${imgCount !== 1 ? 's' : ''} across ` +
            `${dates.length} date${dates.length !== 1 ? 's' : ''} (${dates[0]} to ${dates[dates.length - 1]}).`;
        const details = { imgCount, nDates: dates.length, dateSpan: `${dates[0]}..${dates[dates.length - 1]}` };
        let changeDetected = false;
        let cvaImage = null;

        // Real CVA analysis: render the change map and measure changed pixels
        if (monitor.includeCVA) {
            if (dates.length >= 2) {
                try {
                    const cva = await this._computeCVA(monitor, bbox, dates[0], dates[dates.length - 1], token);
                    summary += ` CVA: ${cva.changedPct}% of area changed — ${cva.breakdownText}.`;
                    details.cvaChangedPct = cva.changedPct + '%';
                    Object.assign(details, cva.classDetails);
                    details.cva = true;
                    changeDetected = parseFloat(cva.changedPct) >= 1.0;
                    cvaImage = cva.dataUrl;
                } catch (err) {
                    summary += ` CVA analysis failed: ${err.message}`;
                }
            } else {
                summary += ' CVA needs imagery on at least 2 dates — none to compare yet.';
            }
        } else {
            summary += ' Enable CVA on this zone for automatic change analysis.';
        }

        return { summary, details, changeDetected, cvaImage };
    },

    // ---- CVA computation ----

    async _computeCVA(monitor, bbox, fromDate, toDate, token) {
        const isS1 = monitor.source === 'sentinel1';
        const evalscript = isS1
            ? FunMap.Sentinel._getCVAEvalscriptS1()
            : FunMap.Sentinel._getCVAEvalscript();

        const dataConfig = isS1
            ? {
                type: 'sentinel-1-grd',
                dataFilter: {
                    timeRange: { from: fromDate + 'T00:00:00Z', to: toDate + 'T23:59:59Z' },
                    mosaickingOrder: 'mostRecent',
                },
                processing: { backCoeff: 'GAMMA0_TERRAIN', orthorectify: true },
            }
            : {
                type: 'sentinel-2-l2a',
                dataFilter: {
                    timeRange: { from: fromDate + 'T00:00:00Z', to: toDate + 'T23:59:59Z' },
                    maxCloudCoverage: 40,
                    mosaickingOrder: 'mostRecent',
                },
            };

        // Output size: preserve the zone's aspect ratio, max 640px
        const lonSpan = Math.max(1e-6, bbox[2] - bbox[0]);
        const latSpan = Math.max(1e-6, bbox[3] - bbox[1]);
        const midLat = ((bbox[1] + bbox[3]) / 2) * Math.PI / 180;
        const aspect = (lonSpan * Math.cos(midLat)) / latSpan;
        let width, height;
        if (aspect >= 1) {
            width = 640;
            height = FunMap.Utils.clamp(Math.round(640 / aspect), 64, 1024);
        } else {
            height = 640;
            width = FunMap.Utils.clamp(Math.round(640 * aspect), 64, 1024);
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

        const resp = await fetch(FunMap.Config.CDSE.processEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'image/png',
            },
            body: JSON.stringify(requestBody),
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`${resp.status} ${errText.substring(0, 120)}`);
        }

        const blob = await resp.blob();

        // Decode the PNG and count changed pixels per CVA class
        const objUrl = URL.createObjectURL(blob);
        let img;
        try {
            img = await new Promise((res, rej) => {
                const i = new Image();
                i.onload = () => res(i);
                i.onerror = () => rej(new Error('Could not decode CVA image'));
                i.src = objUrl;
            });
        } finally {
            URL.revokeObjectURL(objUrl);
        }

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        // Class base colors from the evalscripts:
        //   green (0.05,1,0.05)  magenta (1,0.2,0.8)  cyan (0.2,0.8,1)  amber (1,0.67,0)
        const counts = { green: 0, magenta: 0, cyan: 0, amber: 0 };
        const total = canvas.width * canvas.height;
        for (let i = 0; i < px.length; i += 4) {
            const a = px[i + 3];
            if (a < 30) continue; // unchanged or no-data
            const r = px[i], g = px[i + 1], b = px[i + 2];
            if (g >= r && g >= b) counts.green++;
            else if (b >= r) counts.cyan++;
            else if (b > g) counts.magenta++;
            else counts.amber++;
        }

        const changed = counts.green + counts.magenta + counts.cyan + counts.amber;
        const pct = n => (n / total * 100).toFixed(1);

        // Class labels differ between optical and SAR CVA
        const labels = isS1
            ? { green: 'new structures', magenta: 'roughening', cyan: 'smoothing/clearing', amber: 'mixed' }
            : { green: 'structure', magenta: 'soil', cyan: 'water', amber: 'vegetation' };

        const breakdown = Object.keys(counts)
            .filter(k => counts[k] > 0)
            .sort((a, b) => counts[b] - counts[a])
            .map(k => `${labels[k]} ${pct(counts[k])}%`);

        const classDetails = {};
        Object.keys(counts).forEach(k => {
            if (counts[k] > 0) classDetails[labels[k]] = pct(counts[k]) + '%';
        });

        return {
            changedPct: pct(changed),
            breakdownText: breakdown.length > 0 ? breakdown.join(', ') : 'no class breakdown',
            classDetails: classDetails,
            dataUrl: canvas.toDataURL('image/png'),
        };
    },

    // ---- CVA overlay on the main map ----

    _removeCVAOverlay() {
        if (this._cvaOverlay) {
            FunMap.Map.map.removeLayer(this._cvaOverlay);
            this._cvaOverlay = null;
            this._cvaOverlayEntry = null;
            this._cvaOverlayMon = null;
        }
    },

    async _viewCVA(monId, entryId) {
        // Toggle off if the same entry's overlay is already shown
        if (this._cvaOverlay && this._cvaOverlayEntry === entryId) {
            this._removeCVAOverlay();
            return;
        }

        const mon = this._monitors.find(m => m.id === monId);
        if (!mon) return;
        const entry = mon.changelog.find(e => e.id === entryId);
        if (!entry) return;

        let imgSrc = entry.cvaImage;

        // Older entries have their snapshot stripped — recompute live
        if (!imgSrc) {
            FunMap.Utils.toast('Recomputing CVA for this period...', 'info');
            try {
                const token = await FunMap.Settings.getCDSEToken();
                const bbox = FunMap.Utils.bboxFromBounds(this._monitorBounds(mon));
                const cva = await this._computeCVA(mon, bbox, entry.rangeFrom, entry.rangeTo, token);
                imgSrc = cva.dataUrl;
            } catch (err) {
                FunMap.Utils.toast('CVA recompute failed: ' + err.message, 'error');
                return;
            }
        }

        this._removeCVAOverlay();
        const bounds = this._monitorBounds(mon);
        this._cvaOverlay = L.imageOverlay(imgSrc, bounds, { opacity: 0.9, interactive: false });
        this._cvaOverlay.addTo(FunMap.Map.map);
        this._cvaOverlayEntry = entryId;
        this._cvaOverlayMon = monId;

        this._closeChangelog();
        FunMap.Map.map.fitBounds(bounds, { padding: [40, 40] });
        FunMap.Utils.toast('CVA overlay shown. Open the changelog and click VIEW CVA again to hide it.', 'info', 5000);
    },

    // ---- Changelog modal ----

    _openChangelog(id) {
        const mon = this._monitors.find(m => m.id === id);
        if (!mon) return;

        document.getElementById('janus-changelog-title').textContent = mon.name;
        const body = document.getElementById('janus-changelog-body');

        if (mon.changelog.length === 0) {
            body.innerHTML = '<div class="empty-state">No reports yet. Run a check to generate the first report.</div>';
        } else {
            const esc = FunMap.Utils.escapeHtml;
            let html = '';
            mon.changelog.forEach(entry => {
                const changeClass = entry.changeDetected ? 'janus-change-yes' : 'janus-change-no';
                const changeIcon = entry.changeDetected ? '!' : '-';
                const hasCva = entry.details && entry.details.cva;
                html += `<div class="janus-changelog-entry ${changeClass}">
                    <div class="janus-changelog-date">
                        <span class="janus-changelog-icon">${changeIcon}</span>
                        <span>${FunMap.Utils.formatDate(entry.date)}</span>
                        <span class="janus-changelog-range">${esc(entry.rangeFrom)} to ${esc(entry.rangeTo)}</span>
                    </div>
                    <div class="janus-changelog-summary">${esc(entry.summary)}</div>
                    ${entry.details && Object.keys(entry.details).length > 0 ? `
                    <div class="janus-changelog-details">
                        ${Object.entries(entry.details)
                            .filter(([k]) => k !== 'cva')
                            .map(([k, v]) =>
                                `<span class="janus-detail-tag">${esc(k)}: ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`
                            ).join('')}
                    </div>` : ''}
                    ${hasCva ? `<div class="janus-changelog-actions">
                        <button class="xbox-btn xs janus-btn-viewcva" data-entry="${entry.id}">VIEW CVA ON MAP</button>
                    </div>` : ''}
                </div>`;
            });
            body.innerHTML = html;

            body.querySelectorAll('.janus-btn-viewcva').forEach(btn => {
                btn.addEventListener('click', () => this._viewCVA(id, btn.dataset.entry));
            });
        }

        document.getElementById('janus-changelog-dialog').classList.remove('hidden');
    },

    _closeChangelog() {
        document.getElementById('janus-changelog-dialog').classList.add('hidden');
    },

    // ---- Auto-check due monitors ----

    async _checkDueMonitors() {
        const due = this._monitors.filter(m => this._isDue(m));
        if (due.length === 0) return;

        const runnable = due.filter(m => this._credsAvailable(m));
        const blocked = due.length - runnable.length;

        if (runnable.length > 0) {
            FunMap.Utils.toast(
                `Janus Eye: running ${runnable.length} due check${runnable.length !== 1 ? 's' : ''}...`,
                'info', 5000
            );
            // Run sequentially to avoid hammering the APIs
            for (const mon of runnable) {
                await this._runCheck(mon.id);
            }
        }
        if (blocked > 0) {
            FunMap.Utils.toast(
                `Janus Eye: ${blocked} due zone${blocked !== 1 ? 's' : ''} skipped — API keys missing (Settings > API Keys).`,
                'warning', 6000
            );
        }
    },
};
