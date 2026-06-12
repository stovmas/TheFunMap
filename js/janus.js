/* ============================================
   THE FUN MAP - Janus Eye: Area Monitoring
   ============================================ */

/* ---- IndexedDB store for zone imagery (blobs are too big for localStorage) ---- */

FunMap.JanusDB = {
    _dbPromise: null,

    _open() {
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open('funmap_janus', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return this._dbPromise;
    },

    async putImage(key, blob) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('images', 'readwrite');
            tx.objectStore('images').put(blob, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async getImage(key) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('images', 'readonly');
            const req = tx.objectStore('images').get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    },

    async deleteImages(keys) {
        if (!keys || keys.length === 0) return;
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('images', 'readwrite');
            const store = tx.objectStore('images');
            keys.forEach(k => store.delete(k));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
};

/* ---- Janus Eye ---- */

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
    _checkInFlight: {},        // monitor id -> true while a check runs
    _viewerMon: null,          // monitor id open in the viewer
    _viewerEntry: null,        // entry id selected in the viewer
    _viewerUrls: [],           // object URLs to revoke

    // Keep stored imagery for this many newest reports per zone
    KEEP_IMAGE_ENTRIES: 12,
    MAX_LOG_ENTRIES: 50,

    SOURCE_LABELS: {
        sentinel2: 'Sentinel-2', sentinel1: 'Sentinel-1 SAR',
        firms: 'NASA FIRMS', conflict: 'Conflict Events',
    },
    SOURCE_SHORT: { sentinel2: 'S2', sentinel1: 'S1', firms: 'FIRES', conflict: 'CONFLICT' },
    DEFAULT_VIZ: {
        sentinel2: ['TRUE_COLOR'],
        sentinel1: ['VV'],
        firms: ['VIIRS_SNPP_NRT'],
        conflict: ['1', '2', '3'],
    },
    CONFLICT_TYPE_LABELS: { '1': 'State-based', '2': 'Non-state', '3': 'One-sided' },

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
        document.getElementById('janus-config-cancel-x').addEventListener('click', () => this._closeConfig());
        document.getElementById('janus-config-dialog').addEventListener('click', (e) => {
            if (e.target.id === 'janus-config-dialog') this._closeConfig();
        });

        // Source checkboxes toggle their layer-option groups + CVA row
        document.querySelectorAll('.janus-src-cb').forEach(cb => {
            cb.addEventListener('change', () => this._syncConfigGroups());
        });

        // Viewer
        document.getElementById('janus-viewer-close').addEventListener('click', () => this._closeViewer());
        const opacity = document.getElementById('janus-viewer-cva-opacity');
        opacity.addEventListener('input', () => {
            document.getElementById('janus-viewer-cva-opacity-val').textContent = opacity.value + '%';
            document.getElementById('janus-viewer-img-cva').style.opacity = opacity.value / 100;
        });

        // Render stored monitors
        this._renderMonitorList();
        this._renderMonitorZones();

        // Auto-run due monitors shortly after boot, then hourly while open
        setTimeout(() => this._checkDueMonitors(), 5000);
        setInterval(() => this._checkDueMonitors(), 60 * 60 * 1000);
    },

    // ---- Storage & migration ----

    _loadFromStorage() {
        let monitors;
        try {
            const raw = localStorage.getItem('funmap_janus_monitors');
            monitors = raw ? JSON.parse(raw) : [];
        } catch { return []; }

        // Migrate older single-source monitors to the multi-source format
        monitors.forEach(m => {
            if (!m.sources) {
                const src = m.source || 'sentinel2';
                m.sources = [src];
                m.viz = {};
                if (src === 'sentinel2' || src === 'sentinel1') {
                    m.viz[src] = [m.visualization || this.DEFAULT_VIZ[src][0]];
                } else {
                    m.viz[src] = this.DEFAULT_VIZ[src].slice();
                }
                delete m.source;
                delete m.visualization;
            }
            m.viz = m.viz || {};
            m.changelog = m.changelog || [];
            m.changelog.forEach(e => {
                delete e.cvaImage; // old data-URL snapshots — superseded by IndexedDB
                e.images = e.images || [];
                e.cvas = e.cvas || [];
            });
        });
        return monitors;
    },

    _saveToStorage() {
        try {
            localStorage.setItem('funmap_janus_monitors', JSON.stringify(this._monitors));
        } catch (err) {
            FunMap.Utils.toast('Could not save watch zones: ' + err.message, 'error');
        }
    },

    // ---- Drawing ----

    _startDraw(mode) {
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

    _onRectStart(e) {
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
                color: '#87c540', weight: 2, fillColor: '#87c540',
                fillOpacity: 0.15, dashArray: '6,4', interactive: false,
            });
            this._drawLayers.addLayer(this._drawRect);
        }
    },

    _onRectEnd(e) {
        FunMap.Map.map.off('mousemove', this._onRectMove, this);
        FunMap.Map.map.off('mouseup', this._onRectEnd, this);

        if (!this._drawStartLatLng) { this._cancelDraw(); return; }

        const bounds = L.latLngBounds(this._drawStartLatLng, e.latlng);
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

    _onPolyClick(e) {
        this._drawPoints.push(e.latlng);

        const marker = L.circleMarker(e.latlng, {
            radius: 4, fillColor: '#87c540', color: '#fff', weight: 2,
            fillOpacity: 1, interactive: false,
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

        // Double-click fires two click events first — strip duplicate trailing vertices
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

    _captureViewport() {
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

        // Reset all source / viz checkboxes
        document.querySelectorAll('.janus-src-cb').forEach(cb => { cb.checked = false; });
        document.querySelectorAll('.janus-viz-cb').forEach(cb => { cb.checked = false; });

        if (existingId) {
            const mon = this._monitors.find(m => m.id === existingId);
            if (!mon) return;
            titleEl.textContent = 'EDIT WATCH ZONE';
            document.getElementById('janus-config-name').value = mon.name;
            document.getElementById('janus-config-interval').value = mon.interval;
            mon.sources.forEach(src => {
                const cb = document.querySelector(`.janus-src-cb[value="${src}"]`);
                if (cb) cb.checked = true;
                (mon.viz[src] || []).forEach(v => {
                    const vcb = document.querySelector(`.janus-viz-cb[data-source="${src}"][value="${v}"]`);
                    if (vcb) vcb.checked = true;
                });
            });
            document.getElementById('janus-config-cva').checked = !!mon.includeCVA;
            dialog.dataset.editId = existingId;
        } else {
            titleEl.textContent = 'CONFIGURE WATCH ZONE';
            document.getElementById('janus-config-name').value = '';
            document.getElementById('janus-config-interval').value = 'weekly';
            // Sensible defaults: Sentinel-2 true color
            const s2 = document.querySelector('.janus-src-cb[value="sentinel2"]');
            if (s2) s2.checked = true;
            const tc = document.querySelector('.janus-viz-cb[data-source="sentinel2"][value="TRUE_COLOR"]');
            if (tc) tc.checked = true;
            document.getElementById('janus-config-cva').checked = true;
            delete dialog.dataset.editId;
        }

        this._syncConfigGroups();
        dialog.classList.remove('hidden');
    },

    _syncConfigGroups() {
        let anySentinel = false;
        document.querySelectorAll('.janus-src-cb').forEach(cb => {
            const group = document.querySelector(`.janus-viz-group[data-for="${cb.value}"]`);
            if (group) group.classList.toggle('hidden', !cb.checked);
            if (cb.checked && cb.value.startsWith('sentinel')) anySentinel = true;
        });
        document.getElementById('janus-config-cva-row').style.display = anySentinel ? '' : 'none';
    },

    _closeConfig() {
        const dialog = document.getElementById('janus-config-dialog');
        dialog.classList.add('hidden');
        if (!dialog.dataset.editId) {
            this._drawLayers.clearLayers();
            this._pendingGeometry = null;
        }
        delete dialog.dataset.editId;
    },

    _collectConfigSelections() {
        const sources = [];
        const viz = {};
        document.querySelectorAll('.janus-src-cb:checked').forEach(cb => {
            const src = cb.value;
            sources.push(src);
            viz[src] = [];
            document.querySelectorAll(`.janus-viz-cb[data-source="${src}"]:checked`).forEach(vcb => {
                viz[src].push(vcb.value);
            });
            // A source with nothing ticked falls back to its default layer
            if (viz[src].length === 0) viz[src] = this.DEFAULT_VIZ[src].slice();
        });
        return { sources, viz };
    },

    _saveMonitor() {
        const dialog = document.getElementById('janus-config-dialog');
        const name = document.getElementById('janus-config-name').value.trim();
        if (!name) {
            FunMap.Utils.toast('Enter a name for the watch zone.', 'warning');
            return;
        }

        const { sources, viz } = this._collectConfigSelections();
        if (sources.length === 0) {
            FunMap.Utils.toast('Select at least one data source.', 'warning');
            return;
        }

        const interval = document.getElementById('janus-config-interval').value;
        const includeCVA = document.getElementById('janus-config-cva').checked &&
            sources.some(s => s.startsWith('sentinel'));

        const editId = dialog.dataset.editId;
        if (editId) {
            const mon = this._monitors.find(m => m.id === editId);
            if (!mon) return;
            mon.name = name;
            mon.interval = interval;
            mon.sources = sources;
            mon.viz = viz;
            mon.includeCVA = includeCVA;
            mon.nextCheck = this._computeNextCheck(interval, mon.lastCheck || mon.createdAt);
        } else {
            if (!this._pendingGeometry) {
                FunMap.Utils.toast('No area selected. Draw an area first.', 'error');
                return;
            }
            const now = new Date().toISOString();
            this._monitors.push({
                id: FunMap.Utils.uid(),
                name: name,
                geometry: this._pendingGeometry,
                interval: interval,
                sources: sources,
                viz: viz,
                includeCVA: includeCVA,
                createdAt: now,
                lastCheck: null,
                nextCheck: now,         // first check is due immediately
                waitingForImagery: false,
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
        FunMap.Utils.toast('Watch zone saved. Use CHECK NOW to pull the latest imagery.', 'success');
    },

    // ---- Interval & misc helpers ----

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
        for (const src of mon.sources) {
            if (src === 'firms' && !FunMap.Settings.getApiKey('firms_key')) return false;
            if ((src === 'sentinel2' || src === 'sentinel1') &&
                (!FunMap.Settings.getApiKey('cdse_client_id') || !FunMap.Settings.getApiKey('cdse_client_secret'))) {
                return false;
            }
        }
        return true;
    },

    /** Most recent saved image date for a given source, or null */
    _lastImageDateFor(mon, src) {
        for (const entry of mon.changelog) {
            const dates = (entry.images || []).filter(i => i.source === src).map(i => i.date);
            if (dates.length > 0) return dates.sort().pop();
        }
        return null;
    },

    /** Output dimensions for a zone image, aspect-corrected, max edge 768 */
    _imageDims(bbox, maxEdge = 768) {
        const lonSpan = Math.max(1e-6, bbox[2] - bbox[0]);
        const latSpan = Math.max(1e-6, bbox[3] - bbox[1]);
        const midLat = ((bbox[1] + bbox[3]) / 2) * Math.PI / 180;
        const aspect = (lonSpan * Math.cos(midLat)) / latSpan;
        let w, h;
        if (aspect >= 1) {
            w = maxEdge;
            h = FunMap.Utils.clamp(Math.round(maxEdge / aspect), 64, 1536);
        } else {
            h = maxEdge;
            w = FunMap.Utils.clamp(Math.round(maxEdge * aspect), 64, 1536);
        }
        return { width: w, height: h };
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
            const srcText = mon.sources.map(s => this.SOURCE_SHORT[s] || s).join('+');
            const waiting = mon.waitingForImagery ? ' <span class="janus-waiting">AWAITING IMAGERY</span>' : '';

            html += `<div class="janus-monitor-item ${dueClass}" data-id="${mon.id}">
                <div class="janus-monitor-header">
                    <span class="janus-monitor-name">${esc(mon.name)}</span>
                    <span class="janus-monitor-badge">${this._intervalLabel(mon.interval)}</span>
                </div>
                <div class="janus-monitor-meta">
                    <span>${srcText}</span>
                    <span>|</span>
                    <span>${changeCount} report${changeCount !== 1 ? 's' : ''}</span>
                    <span>|</span>
                    <span>Last: ${lastChange}</span>${waiting}
                </div>
                <div class="janus-monitor-actions">
                    <button class="xbox-btn xs janus-btn-check" data-id="${mon.id}" title="Pull latest imagery now"${due ? ' style="border-color:var(--xbox-orange);color:var(--xbox-orange)"' : ''}>
                        ${due ? 'CHECK (DUE)' : 'CHECK NOW'}
                    </button>
                    <button class="xbox-btn xs janus-btn-log" data-id="${mon.id}" title="Open report viewer">LOG</button>
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
        wire('.janus-btn-check', id => this._runCheck(id, true));
        wire('.janus-btn-log', id => this._openViewer(id));
        wire('.janus-btn-fly', id => this._flyToMonitor(id));
        wire('.janus-btn-edit', id => this._openConfig(id));
        wire('.janus-btn-delete', id => this._deleteMonitor(id));
    },

    _renderMonitorZones() {
        this._layerGroup.clearLayers();
        const esc = FunMap.Utils.escapeHtml;

        this._monitors.forEach(mon => {
            const geom = mon.geometry;
            const style = {
                color: '#87c540', weight: 1.5, fillColor: '#87c540',
                fillOpacity: 0.04, dashArray: '8,4',
            };
            let shape;
            if (geom.type === 'rectangle' || geom.type === 'viewport') {
                shape = L.rectangle(geom.bounds, style);
            } else if (geom.type === 'polygon') {
                shape = L.polygon(geom.coords, style);
            }

            if (shape) {
                const srcText = mon.sources.map(s => this.SOURCE_LABELS[s] || s).join(', ');
                shape.bindTooltip(`<b>${esc(mon.name)}</b><br>${this._intervalLabel(mon.interval)} | ${srcText}`, {
                    className: 'conflict-tooltip',
                    direction: 'top',
                });
                shape.on('click', () => {
                    if (this._drawMode || this._suppressZoneClick) return;
                    this._openViewer(mon.id);
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

    async _deleteMonitor(id) {
        const mon = this._monitors.find(m => m.id === id);
        this._monitors = this._monitors.filter(m => m.id !== id);
        this._saveToStorage();
        this._renderMonitorList();
        this._renderMonitorZones();
        if (this._viewerMon === id) this._closeViewer();

        // Remove stored imagery for this zone
        if (mon) {
            const keys = [];
            mon.changelog.forEach(e => {
                (e.images || []).forEach(i => keys.push(i.key));
                (e.cvas || []).forEach(c => keys.push(c.key));
            });
            FunMap.JanusDB.deleteImages(keys).catch(() => {});
        }
        FunMap.Utils.toast('Watch zone deleted.', 'success');
    },

    // ---- Check flow ----

    async _runCheck(id, manual = true) {
        const mon = this._monitors.find(m => m.id === id);
        if (!mon || this._checkInFlight[id]) return;
        this._checkInFlight[id] = true;

        FunMap.Utils.setStatus(`JANUS EYE - CHECKING "${mon.name.toUpperCase()}"...`);

        try {
            await this._doCheck(mon, manual);
        } finally {
            delete this._checkInFlight[id];
            FunMap.Utils.setStatus('SYSTEMS ONLINE');
        }
    },

    async _doCheck(mon, manual) {
        const now = new Date();
        const nowStr = FunMap.Utils.toISODate(now);
        const rangeFrom = FunMap.Utils.toISODate(new Date(mon.lastCheck || mon.createdAt));

        const bounds = this._monitorBounds(mon);
        const bbox = FunMap.Utils.bboxFromBounds(bounds);
        const dims = this._imageDims(bbox);

        const entryId = FunMap.Utils.uid();
        const lines = [];
        const details = {};
        const images = [];
        const cvas = [];
        let changeDetected = false;
        let newImagery = false;
        let token = null;

        const getToken = async () => {
            if (!token) token = await FunMap.Settings.getCDSEToken();
            return token;
        };

        const sentinelSources = mon.sources.filter(s => s.startsWith('sentinel'));

        // --- Imagery sources: find the latest available date and pull it ---
        for (const src of sentinelSources) {
            const label = this.SOURCE_SHORT[src];
            try {
                const tok = await getToken();
                const prevDate = this._lastImageDateFor(mon, src);
                const searchFrom = prevDate
                    ? FunMap.Utils.toISODate(new Date(new Date(prevDate).getTime() + 86400000))
                    : FunMap.Utils.daysAgo(60);

                const latest = await this._findLatestAvailableDate(src, bbox, searchFrom, nowStr, tok);

                if (!latest) {
                    lines.push(prevDate
                        ? `[${label}] No new imagery since ${prevDate}.`
                        : `[${label}] No imagery found in the last 60 days.`);
                    continue;
                }

                newImagery = true;
                const vizList = (mon.viz[src] && mon.viz[src].length > 0)
                    ? mon.viz[src] : this.DEFAULT_VIZ[src];

                for (const viz of vizList) {
                    const blob = await this._fetchZoneImage(src, viz, latest, bbox, dims, tok);
                    const key = `${mon.id}|${entryId}|${src}|${viz}|${latest}`;
                    await FunMap.JanusDB.putImage(key, blob);
                    images.push({ key, source: src, viz, date: latest });
                }

                let line = `[${label}] New imagery ${latest} — saved ${vizList.map(v => v.replace(/_/g, ' ')).join(', ')}.`;
                details[`${src}_date`] = latest;

                // --- CVA against the previous saved image date ---
                if (mon.includeCVA && prevDate) {
                    try {
                        const cva = await this._computeCVA(src, bbox, prevDate, latest, dims, tok);
                        const cvaKey = `${mon.id}|${entryId}|${src}|CVA|${prevDate}_${latest}`;
                        await FunMap.JanusDB.putImage(cvaKey, cva.blob);
                        const baseImg = images.find(i => i.source === src);
                        cvas.push({
                            key: cvaKey,
                            source: src,
                            baseKey: baseImg ? baseImg.key : null,
                            fromDate: prevDate,
                            toDate: latest,
                            changedPct: cva.changedPct,
                            classes: cva.classDetails,
                        });
                        line += ` CVA vs ${prevDate}: ${cva.changedPct}% of area changed` +
                            (cva.breakdownText ? ` — ${cva.breakdownText}` : '') + '.';
                        details[`${src}_cva_pct`] = cva.changedPct + '%';
                        if (parseFloat(cva.changedPct) >= 1.0) changeDetected = true;
                    } catch (err) {
                        line += ` CVA failed: ${err.message}`;
                    }
                } else if (mon.includeCVA && !prevDate) {
                    line += ' CVA starts on the next check (needs a previous image to compare against).';
                }
                lines.push(line);
            } catch (err) {
                lines.push(`[${label}] Check failed: ${err.message}`);
            }
        }

        // --- FIRMS stats ---
        if (mon.sources.includes('firms')) {
            try {
                const r = await this._checkFIRMS(mon, bbox, rangeFrom, nowStr);
                lines.push(r.line);
                Object.assign(details, r.details);
                if (r.changeDetected) changeDetected = true;
            } catch (err) {
                lines.push(`[FIRES] Check failed: ${err.message}`);
            }
        }

        // --- Conflict stats ---
        if (mon.sources.includes('conflict')) {
            try {
                const r = await this._checkConflict(mon, bbox, rangeFrom, nowStr);
                lines.push(r.line);
                Object.assign(details, r.details);
                if (r.changeDetected) changeDetected = true;
            } catch (err) {
                lines.push(`[CONFLICT] Check failed: ${err.message}`);
            }
        }

        // --- Decide: log the report, or wait for imagery ---
        if (sentinelSources.length > 0 && !newImagery) {
            // No new imagery yet — switch to daily watch and retry tomorrow.
            mon.waitingForImagery = true;
            mon.nextCheck = this._computeNextCheck('daily', now.toISOString());
            this._saveToStorage();
            this._renderMonitorList();
            if (manual) {
                FunMap.Utils.toast(
                    `"${mon.name}" — ${lines.join(' ') || 'No new imagery yet.'} Daily watch enabled; the zone will be checked each day until new imagery appears.`,
                    'info', 7000
                );
            }
            return;
        }

        const entry = {
            id: entryId,
            date: now.toISOString(),
            rangeFrom: rangeFrom,
            rangeTo: nowStr,
            summary: lines.join('\n'),
            changeDetected: changeDetected,
            details: details,
            images: images,
            cvas: cvas,
        };

        mon.changelog.unshift(entry);

        // Purge stored imagery beyond the retention window; cap the log
        for (let i = this.KEEP_IMAGE_ENTRIES; i < mon.changelog.length; i++) {
            const old = mon.changelog[i];
            if ((old.images && old.images.length) || (old.cvas && old.cvas.length)) {
                const keys = [];
                (old.images || []).forEach(im => keys.push(im.key));
                (old.cvas || []).forEach(c => keys.push(c.key));
                FunMap.JanusDB.deleteImages(keys).catch(() => {});
                old.images = [];
                old.cvas = [];
                old.imagesPurged = true;
            }
        }
        if (mon.changelog.length > this.MAX_LOG_ENTRIES) {
            mon.changelog.length = this.MAX_LOG_ENTRIES;
        }

        mon.lastCheck = now.toISOString();
        mon.waitingForImagery = false;
        mon.nextCheck = this._computeNextCheck(mon.interval, now.toISOString());

        this._saveToStorage();
        this._renderMonitorList();

        // Refresh the viewer if it's open on this zone
        if (this._viewerMon === mon.id) this._openViewer(mon.id);

        if (changeDetected) {
            FunMap.Utils.toast(`"${mon.name}" — Change detected! Open LOG to review.`, 'warning', 6000);
        } else if (images.length > 0) {
            FunMap.Utils.toast(`"${mon.name}" — Report logged with ${images.length} image${images.length !== 1 ? 's' : ''}. Open LOG to view.`, 'success', 5000);
        } else {
            FunMap.Utils.toast(`"${mon.name}" — Report logged.`, 'success');
        }
    },

    // ---- Catalog: find latest available image date ----

    async _findLatestAvailableDate(src, bbox, fromStr, toStr, token) {
        const isS2 = src === 'sentinel2';
        const collectionId = isS2 ? 'sentinel-2-l2a' : 'sentinel-1-grd';
        const fieldsInclude = ['properties.datetime'];
        if (isS2) fieldsInclude.push('properties.eo:cloud_cover');

        const dates = new Set();
        let nextToken = null;

        for (let page = 0; page < 3; page++) {
            const searchBody = {
                bbox: bbox,
                datetime: `${fromStr}T00:00:00Z/${toStr}T23:59:59Z`,
                collections: [collectionId],
                limit: 100,
                fields: { include: fieldsInclude },
            };
            if (nextToken) searchBody.next = nextToken;

            const resp = await fetch(FunMap.Config.CDSE.catalogEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(searchBody),
            });
            if (!resp.ok) throw new Error('Catalog search failed: ' + resp.status);

            const data = await resp.json();
            (data.features || []).forEach(f => {
                if (!f.properties || !f.properties.datetime) return;
                if (isS2) {
                    const cc = f.properties['eo:cloud_cover'];
                    if (cc !== undefined && cc !== null && cc > 40) return;
                }
                dates.add(f.properties.datetime.split('T')[0]);
            });

            nextToken = (data.context && data.context.next) || null;
            if (!nextToken) break;
        }

        if (dates.size === 0) return null;
        return [...dates].sort().pop();
    },

    // ---- Process API: fetch a rendered zone image ----

    async _fetchProcessImage(requestBody, token) {
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
        return resp.blob();
    },

    async _fetchZoneImage(src, viz, dateStr, bbox, dims, token) {
        const isS2 = src === 'sentinel2';
        const evalscript = isS2
            ? FunMap.Config.S2Evalscripts[viz]
            : FunMap.Config.S1Evalscripts[viz];
        if (!evalscript) throw new Error(`Unknown layer ${viz}`);

        const dataConfig = isS2
            ? {
                type: 'sentinel-2-l2a',
                dataFilter: {
                    timeRange: { from: dateStr + 'T00:00:00Z', to: dateStr + 'T23:59:59Z' },
                    maxCloudCoverage: 100,
                    mosaickingOrder: 'leastCC',
                },
                processing: { upsampling: 'BILINEAR', downsampling: 'BILINEAR' },
            }
            : {
                type: 'sentinel-1-grd',
                dataFilter: {
                    timeRange: { from: dateStr + 'T00:00:00Z', to: dateStr + 'T23:59:59Z' },
                    mosaickingOrder: 'mostRecent',
                },
                processing: { backCoeff: 'GAMMA0_TERRAIN', orthorectify: true },
            };

        return this._fetchProcessImage({
            input: {
                bounds: { bbox: bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
                data: [dataConfig],
            },
            output: {
                width: dims.width,
                height: dims.height,
                responses: [{ identifier: 'default', format: { type: 'image/png' } }],
            },
            evalscript: evalscript,
        }, token);
    },

    // ---- CVA: change map + pixel statistics ----

    async _computeCVA(src, bbox, fromDate, toDate, dims, token) {
        const isS1 = src === 'sentinel1';
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

        const blob = await this._fetchProcessImage({
            input: {
                bounds: { bbox: bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
                data: [dataConfig],
            },
            output: {
                width: dims.width,
                height: dims.height,
                responses: [{ identifier: 'default', format: { type: 'image/png' } }],
            },
            evalscript: evalscript,
        }, token);

        const stats = await this._cvaStatsFromBlob(blob, isS1);
        return { blob, ...stats };
    },

    async _cvaStatsFromBlob(blob, isS1) {
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
            if (a < 30) continue;
            const r = px[i], g = px[i + 1], b = px[i + 2];
            if (g >= r && g >= b) counts.green++;
            else if (b >= r) counts.cyan++;
            else if (b > g) counts.magenta++;
            else counts.amber++;
        }

        const changed = counts.green + counts.magenta + counts.cyan + counts.amber;
        const pct = n => (n / total * 100).toFixed(1);
        const labels = this.cvaClassLabels(isS1 ? 'sentinel1' : 'sentinel2');

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
            breakdownText: breakdown.join(', '),
            classDetails: classDetails,
        };
    },

    cvaClassLabels(src) {
        return src === 'sentinel1'
            ? { green: 'new structures', magenta: 'roughening', cyan: 'smoothing/clearing', amber: 'mixed' }
            : { green: 'structure', magenta: 'soil', cyan: 'water', amber: 'vegetation' };
    },

    CVA_CLASS_COLORS: { green: '#0dff0d', magenta: '#ff33cc', cyan: '#33ccff', amber: '#ffaa00' },

    // ---- FIRMS stats (multi-satellite) ----

    async _checkFIRMS(mon, bbox, fromDate, toDate) {
        const apiKey = FunMap.Settings.getApiKey('firms_key');
        if (!apiKey) {
            return { line: '[FIRES] No FIRMS API key configured.', details: {}, changeDetected: false };
        }

        const periodDays = Math.max(1, Math.ceil((new Date(toDate) - new Date(fromDate)) / 86400000));
        const dayRange = Math.min(10, periodDays);

        const west = Math.max(-180, bbox[0]);
        const south = Math.max(-90, bbox[1]);
        const east = Math.min(180, bbox[2]);
        const north = Math.min(90, bbox[3]);
        const area = `${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}`;

        const sats = (mon.viz.firms && mon.viz.firms.length > 0) ? mon.viz.firms : this.DEFAULT_VIZ.firms;

        const fetches = sats.map(async sat => {
            const url = `${FunMap.Config.FIRMS.areaEndpoint}/csv/${apiKey}/${sat}/${area}/${dayRange}`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`${sat}: HTTP ${resp.status}`);
            const csv = await resp.text();
            if (!csv.includes(',') || csv.length < 40) throw new Error(`${sat}: ${csv.trim() || 'empty response'}`);
            return FunMap.Utils.parseCSV(csv);
        });

        const results = await Promise.allSettled(fetches);
        let rows = [];
        const errors = [];
        results.forEach(r => {
            if (r.status === 'fulfilled') rows = rows.concat(r.value);
            else errors.push(r.reason.message);
        });
        if (rows.length === 0 && errors.length === results.length) {
            throw new Error(errors.join('; '));
        }

        const fireCount = rows.length;
        const highConf = rows.filter(r => r.confidence === 'high' || r.confidence === 'h' || parseFloat(r.confidence) >= 80).length;
        const avgFRP = fireCount > 0 ? (rows.reduce((s, r) => s + (parseFloat(r.frp) || 0), 0) / fireCount).toFixed(1) : 0;
        const truncated = periodDays > 10 ? ' (last 10 days only — FIRMS limit)' : '';

        return {
            line: fireCount > 0
                ? `[FIRES] ${fireCount} detection${fireCount !== 1 ? 's' : ''} (${highConf} high confidence), avg FRP ${avgFRP} MW.${truncated}`
                : `[FIRES] No fire detections.${truncated}`,
            details: { fires: fireCount, firesHighConf: highConf },
            changeDetected: fireCount > 0,
        };
    },

    // ---- Conflict stats (UCDP, type-filtered) ----

    async _checkConflict(mon, bbox, fromDate, toDate) {
        const url = `${FunMap.Config.UCDP.endpoint}?pagesize=1000&StartDate=${fromDate}&EndDate=${toDate}&page=0`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('UCDP API error: ' + resp.status);
        const data = await resp.json();
        const results = data.Result || [];

        const types = (mon.viz.conflict && mon.viz.conflict.length > 0) ? mon.viz.conflict : this.DEFAULT_VIZ.conflict;

        const inZone = results.filter(ev => {
            const lat = parseFloat(ev.latitude);
            const lng = parseFloat(ev.longitude);
            if (!(lat >= bbox[1] && lat <= bbox[3] && lng >= bbox[0] && lng <= bbox[2])) return false;
            return types.includes(String(ev.type_of_violence));
        });

        const totalFatal = inZone.reduce((s, ev) => s + (parseInt(ev.best) || 0), 0);

        return {
            line: inZone.length > 0
                ? `[CONFLICT] ${inZone.length} event${inZone.length !== 1 ? 's' : ''}, ${totalFatal} fatalities.`
                : '[CONFLICT] No conflict events.',
            details: { events: inZone.length, fatalities: totalFatal },
            changeDetected: inZone.length > 0,
        };
    },

    // ---- Report viewer ("LOG" tab) ----

    _openViewer(monId) {
        const mon = this._monitors.find(m => m.id === monId);
        if (!mon) return;

        this._viewerMon = monId;
        document.getElementById('janus-viewer-zone').textContent = mon.name;
        const srcText = mon.sources.map(s => this.SOURCE_LABELS[s] || s).join(' · ');
        document.getElementById('janus-viewer-sub').textContent =
            `${this._intervalLabel(mon.interval)} | ${srcText}${mon.includeCVA ? ' | CVA' : ''}`;

        this._renderViewerReports(mon);
        document.getElementById('janus-viewer').classList.remove('hidden');

        if (mon.changelog.length > 0) {
            this._selectViewerEntry(mon.changelog[0].id);
        } else {
            this._clearViewerStage('No reports yet. Run CHECK NOW on this zone to pull the latest imagery.');
            document.getElementById('janus-viewer-chips').innerHTML = '';
            document.getElementById('janus-viewer-info').innerHTML = '';
            document.getElementById('janus-viewer-cva-controls').classList.add('hidden');
        }
    },

    _closeViewer() {
        document.getElementById('janus-viewer').classList.add('hidden');
        this._viewerMon = null;
        this._viewerEntry = null;
        this._revokeViewerUrls();
    },

    _revokeViewerUrls() {
        this._viewerUrls.forEach(u => URL.revokeObjectURL(u));
        this._viewerUrls = [];
    },

    _renderViewerReports(mon) {
        const list = document.getElementById('janus-viewer-report-list');
        if (mon.changelog.length === 0) {
            list.innerHTML = '<div class="empty-state">No reports yet.</div>';
            return;
        }

        let html = '';
        mon.changelog.forEach(entry => {
            const cls = entry.changeDetected ? 'janus-change-yes' : 'janus-change-no';
            const icon = entry.changeDetected ? '!' : '-';
            const imgCount = (entry.images || []).length;
            const cvaCount = (entry.cvas || []).length;
            const meta = [];
            if (imgCount) meta.push(`${imgCount} img`);
            if (cvaCount) meta.push('CVA');
            if (entry.imagesPurged) meta.push('imagery purged');
            html += `<div class="janus-report-item ${cls}" data-entry="${entry.id}">
                <div class="janus-report-date">
                    <span class="janus-changelog-icon">${icon}</span>
                    <span>${FunMap.Utils.formatDate(entry.date)}</span>
                </div>
                <div class="janus-report-meta">${entry.rangeFrom} → ${entry.rangeTo}${meta.length ? ' · ' + meta.join(' · ') : ''}</div>
            </div>`;
        });
        list.innerHTML = html;

        list.querySelectorAll('.janus-report-item').forEach(item => {
            item.addEventListener('click', () => this._selectViewerEntry(item.dataset.entry));
        });
    },

    _clearViewerStage(message) {
        const base = document.getElementById('janus-viewer-img-base');
        const cva = document.getElementById('janus-viewer-img-cva');
        base.classList.add('hidden');
        base.removeAttribute('src');
        cva.classList.add('hidden');
        cva.removeAttribute('src');
        const msg = document.getElementById('janus-viewer-stage-msg');
        msg.textContent = message || '';
        msg.classList.toggle('hidden', !message);
    },

    async _selectViewerEntry(entryId) {
        const mon = this._monitors.find(m => m.id === this._viewerMon);
        if (!mon) return;
        const entry = mon.changelog.find(e => e.id === entryId);
        if (!entry) return;

        this._viewerEntry = entryId;
        this._revokeViewerUrls();

        // Highlight in the report list
        document.querySelectorAll('#janus-viewer-report-list .janus-report-item').forEach(item => {
            item.classList.toggle('active', item.dataset.entry === entryId);
        });

        // Info panel: summary + detail tags
        const esc = FunMap.Utils.escapeHtml;
        const info = document.getElementById('janus-viewer-info');
        let infoHtml = `<div class="janus-viewer-summary">${esc(entry.summary)}</div>`;
        const detailEntries = Object.entries(entry.details || {});
        if (detailEntries.length > 0) {
            infoHtml += '<div class="janus-changelog-details">' +
                detailEntries.map(([k, v]) =>
                    `<span class="janus-detail-tag">${esc(k)}: ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`
                ).join('') + '</div>';
        }
        info.innerHTML = infoHtml;

        // Chips: one per saved image, plus one per CVA result
        const chips = document.getElementById('janus-viewer-chips');
        chips.innerHTML = '';
        const allChips = [];

        (entry.images || []).forEach(img => {
            allChips.push({
                type: 'image',
                label: `${this.SOURCE_SHORT[img.source]} ${img.viz.replace(/_/g, ' ')} · ${img.date}`,
                img: img,
            });
        });
        (entry.cvas || []).forEach(cva => {
            allChips.push({
                type: 'cva',
                label: `CVA ${this.SOURCE_SHORT[cva.source]} · ${cva.changedPct}% changed`,
                cva: cva,
            });
        });

        if (allChips.length === 0) {
            this._clearViewerStage(entry.imagesPurged
                ? 'Imagery for this report was purged to save space. Stats are preserved above.'
                : 'No imagery in this report (stats only).');
            document.getElementById('janus-viewer-cva-controls').classList.add('hidden');
            return;
        }

        allChips.forEach((chip, idx) => {
            const btn = document.createElement('button');
            btn.className = 'janus-chip' + (chip.type === 'cva' ? ' janus-chip-cva' : '');
            btn.textContent = chip.label;
            btn.addEventListener('click', () => {
                chips.querySelectorAll('.janus-chip').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                if (chip.type === 'image') this._showViewerImage(chip.img);
                else this._showViewerCVA(chip.cva);
            });
            chips.appendChild(btn);
            if (idx === 0) btn.classList.add('active');
        });

        // Default selection: latest CVA if there is one, otherwise the first image
        const defaultChip = allChips.find(c => c.type === 'cva') || allChips[0];
        chips.querySelectorAll('.janus-chip').forEach(c => c.classList.remove('active'));
        chips.children[allChips.indexOf(defaultChip)].classList.add('active');
        if (defaultChip.type === 'cva') await this._showViewerCVA(defaultChip.cva);
        else await this._showViewerImage(defaultChip.img);
    },

    async _blobUrl(key) {
        const blob = await FunMap.JanusDB.getImage(key);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        this._viewerUrls.push(url);
        return url;
    },

    async _showViewerImage(img) {
        const base = document.getElementById('janus-viewer-img-base');
        const cvaEl = document.getElementById('janus-viewer-img-cva');
        cvaEl.classList.add('hidden');
        cvaEl.removeAttribute('src');
        document.getElementById('janus-viewer-cva-controls').classList.add('hidden');

        const url = await this._blobUrl(img.key);
        if (!url) {
            this._clearViewerStage('This image is no longer stored.');
            return;
        }
        document.getElementById('janus-viewer-stage-msg').classList.add('hidden');
        base.src = url;
        base.classList.remove('hidden');
    },

    async _showViewerCVA(cva) {
        const base = document.getElementById('janus-viewer-img-base');
        const cvaEl = document.getElementById('janus-viewer-img-cva');

        // CVA renders on top of the actual "after" satellite image
        const baseUrl = cva.baseKey ? await this._blobUrl(cva.baseKey) : null;
        const cvaUrl = await this._blobUrl(cva.key);

        if (!cvaUrl) {
            this._clearViewerStage('This CVA snapshot is no longer stored.');
            return;
        }

        document.getElementById('janus-viewer-stage-msg').classList.add('hidden');
        if (baseUrl) {
            base.src = baseUrl;
            base.classList.remove('hidden');
        } else {
            base.classList.add('hidden');
            base.removeAttribute('src');
        }
        cvaEl.src = cvaUrl;
        const opacity = document.getElementById('janus-viewer-cva-opacity');
        cvaEl.style.opacity = opacity.value / 100;
        cvaEl.classList.remove('hidden');

        // Controls: opacity slider + legend with this source's class labels
        const controls = document.getElementById('janus-viewer-cva-controls');
        controls.classList.remove('hidden');
        const labels = this.cvaClassLabels(cva.source);
        const legend = document.getElementById('janus-viewer-legend');
        legend.innerHTML = Object.keys(labels).map(k =>
            `<span class="janus-legend-item"><span class="cva-swatch" style="background:${this.CVA_CLASS_COLORS[k]}"></span>${labels[k]}</span>`
        ).join('');
    },

    // ---- Scheduler: auto-run due checks ----

    async _checkDueMonitors() {
        const due = this._monitors.filter(m => this._isDue(m) && !this._checkInFlight[m.id]);
        if (due.length === 0) return;

        const runnable = due.filter(m => this._credsAvailable(m));
        const blocked = due.length - runnable.length;

        if (runnable.length > 0) {
            FunMap.Utils.toast(
                `Janus Eye: running ${runnable.length} due check${runnable.length !== 1 ? 's' : ''}...`,
                'info', 5000
            );
            for (const mon of runnable) {
                await this._runCheck(mon.id, false);
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
