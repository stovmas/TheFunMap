/* ============================================
   OWNER REPORT - Sidebar UI + report viewer
   Farm list, draw/import, run, view, PDF.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.UI = {
    _farmLayer: null,
    _drawPoints: [],
    _drawLayers: null,
    _drawTarget: null,   // 'farm' | 'comp' | 'redraw'
    _drawFarmId: null,

    async init() {
        this._farmLayer = L.layerGroup().addTo(FunMap.Map.map);
        this._drawLayers = L.layerGroup().addTo(FunMap.Map.map);
        await FunMap.Owner.Model.ensureDefaultFirm();

        document.getElementById('owner-draw-farm').addEventListener('click', () => this._startDraw('farm'));
        document.getElementById('owner-import').addEventListener('click', () =>
            document.getElementById('owner-import-file').click());
        document.getElementById('owner-import-file').addEventListener('change', e => this._importFile(e));
        document.getElementById('owner-seed-moby').addEventListener('click', () => this._seedMoby());
        document.getElementById('owner-viewer-close').addEventListener('click', () => this.closeViewer());

        await FunMap.Owner.Portfolio.ensureDefault();
        FunMap.Owner.Dashboard.init();
        FunMap.Owner.Scheduler.init();
        await this.refreshList();
    },

    async refreshList() {
        const farms = await FunMap.Owner.Model.getFarms();
        const list = document.getElementById('owner-farm-list');
        const esc = FunMap.Utils.escapeHtml;

        if (farms.length === 0) {
            list.innerHTML = '<div class="empty-state">No farms yet. Draw, import, or load the seed parcel.</div>';
        } else {
            list.innerHTML = farms.map(f => `
                <div class="janus-monitor-item" data-id="${f.id}">
                    <div class="janus-monitor-header">
                        <span class="janus-monitor-name">${esc(f.name)}${f.isDraft ? ' <span class="janus-waiting">DRAFT</span>' : ''}</span>
                        <span class="janus-monitor-badge">${f.acreage} AC</span>
                    </div>
                    <div class="janus-monitor-meta">
                        <span>${esc(f.county || '?')}${f.state ? ', ' + esc(f.state) : ''}</span>
                        <span>|</span><span>${esc(f.cropType || 'crop?')}</span>
                        <span>|</span><span>${f.comparisonRings.length} comps</span>
                    </div>
                    <div class="janus-monitor-actions">
                        <button class="xbox-btn xs o-run" data-id="${f.id}">RUN REPORT</button>
                        <button class="xbox-btn xs o-view" data-id="${f.id}" ${f.lastAssessmentId ? '' : 'disabled'}>VIEW</button>
                        <button class="xbox-btn xs o-comp" data-id="${f.id}" title="Draw a comparison polygon on a nearby field">+COMP</button>
                        <button class="xbox-btn xs ghost o-redraw" data-id="${f.id}" title="Redraw boundary">REDRAW</button>
                        <button class="xbox-btn xs o-fly" data-id="${f.id}">FLY</button>
                        <button class="xbox-btn xs ghost accent o-del" data-id="${f.id}">DEL</button>
                    </div>
                </div>`).join('');
        }

        const wire = (cls, fn) => list.querySelectorAll(cls).forEach(b =>
            b.addEventListener('click', e => { e.stopPropagation(); fn(b.dataset.id); }));
        wire('.o-run', id => this._runReport(id));
        wire('.o-view', id => this.openViewer(id));
        wire('.o-comp', id => this._startDraw('comp', id));
        wire('.o-redraw', id => this._startDraw('redraw', id));
        wire('.o-fly', id => this._fly(id));
        wire('.o-del', id => this._delete(id));

        this._renderFarmShapes(farms);
    },

    _renderFarmShapes(farms) {
        const G = FunMap.Owner.Geometry;
        this._farmLayer.clearLayers();
        farms.forEach(f => {
            const poly = L.polygon(G.toLeaflet(f.ring), {
                color: '#ffd84d', weight: 2, fillColor: '#ffd84d', fillOpacity: 0.05,
            }).bindTooltip(`${FunMap.Utils.escapeHtml(f.name)} (${f.acreage} ac)`, { className: 'conflict-tooltip' });
            this._farmLayer.addLayer(poly);
            (f.comparisonRings || []).forEach(r => {
                this._farmLayer.addLayer(L.polygon(G.toLeaflet(r), {
                    color: '#7fb2ff', weight: 1.5, fillOpacity: 0.03, dashArray: '4,4',
                }));
            });
        });
    },

    // ---- Polygon drawing (farm boundary / comparison field) ----

    _startDraw(target, farmId) {
        this._cancelDraw();
        this._drawTarget = target;
        this._drawFarmId = farmId || null;
        this._drawPoints = [];
        const map = FunMap.Map.map;
        map.getContainer().style.cursor = 'crosshair';
        map.doubleClickZoom.disable();
        map.on('click', this._onDrawClick, this);
        map.on('dblclick', this._onDrawFinish, this);
        this._escHandler = e => { if (e.key === 'Escape') this._cancelDraw(); };
        document.addEventListener('keydown', this._escHandler);
        FunMap.Utils.toast(target === 'comp'
            ? 'Draw a polygon on a comparable NEARBY field. Double-click to finish.'
            : 'Draw the farm boundary. Double-click to finish. ESC cancels.', 'info', 5000);
    },

    _onDrawClick(e) {
        this._drawPoints.push(e.latlng);
        this._drawLayers.addLayer(L.circleMarker(e.latlng, {
            radius: 4, fillColor: '#ffd84d', color: '#fff', weight: 2, fillOpacity: 1, interactive: false }));
        if (this._drawPoints.length > 1) {
            const p = this._drawPoints;
            this._drawLayers.addLayer(L.polyline([p[p.length - 2], p[p.length - 1]], {
                color: '#ffd84d', weight: 2, dashArray: '6,4', interactive: false }));
        }
    },

    async _onDrawFinish(e) {
        L.DomEvent.stop(e);
        const map = FunMap.Map.map;
        const pts = this._drawPoints;
        while (pts.length > 3) {
            const a = map.latLngToContainerPoint(pts[pts.length - 1]);
            const b = map.latLngToContainerPoint(pts[pts.length - 2]);
            if (a.distanceTo(b) < 10) pts.pop(); else break;
        }
        if (pts.length < 3) { FunMap.Utils.toast('Need at least 3 points.', 'warning'); return; }

        const ring = FunMap.Owner.Geometry.fromLeaflet(pts.map(p => [p.lat, p.lng]));
        const target = this._drawTarget, farmId = this._drawFarmId;
        this._cancelDraw();

        if (target === 'farm') {
            const name = prompt('Farm name:', 'New Farm');
            if (!name) return;
            const crop = prompt('Crop type (optional):', '') || '';
            await FunMap.Owner.Model.createFarm({ name, ring, cropType: crop });
            FunMap.Utils.toast('Farm created.', 'success');
        } else if (target === 'redraw' && farmId) {
            const farm = await FunMap.Owner.Model.getFarm(farmId);
            if (!farm) return;
            farm.ring = ring;
            farm.isDraft = false;
            await FunMap.Owner.Model.updateFarm(farm);
            FunMap.Utils.toast('Boundary updated. Re-run the report to use it.', 'success');
        } else if (target === 'comp' && farmId) {
            const farm = await FunMap.Owner.Model.getFarm(farmId);
            if (!farm) return;
            farm.comparisonRings.push(ring);
            await FunMap.Owner.DB.put('farms', farm);
            FunMap.Utils.toast(`Comparison field added (${farm.comparisonRings.length} total).`, 'success');
        }
        await this.refreshList();
    },

    _cancelDraw() {
        const map = FunMap.Map.map;
        map.getContainer().style.cursor = '';
        map.doubleClickZoom.enable();
        map.off('click', this._onDrawClick, this);
        map.off('dblclick', this._onDrawFinish, this);
        if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
        this._drawLayers.clearLayers();
        this._drawPoints = [];
        this._drawTarget = null;
    },

    get drawing() { return !!this._drawTarget; },

    // ---- Actions ----

    async _importFile(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const farms = await FunMap.Owner.Importer.importText(await file.text());
            FunMap.Utils.toast(`Imported ${farms.length} farm${farms.length !== 1 ? 's' : ''}.`, 'success');
            await this.refreshList();
        } catch (err) {
            FunMap.Utils.toast('Import failed: ' + err.message, 'error');
        }
    },

    async _seedMoby() {
        const farm = await FunMap.Owner.Importer.seedMobyRoadFarm();
        await this.refreshList();
        this._fly(farm.id);
        FunMap.Utils.toast('Moby Road Farm loaded (DRAFT boundary — use REDRAW to correct it).', 'warning', 7000);
    },

    async _fly(id) {
        const farm = await FunMap.Owner.Model.getFarm(id);
        if (!farm) return;
        const G = FunMap.Owner.Geometry;
        FunMap.Map.map.fitBounds(L.polygon(G.toLeaflet(farm.ring)).getBounds(), { padding: [60, 60] });
    },

    async _delete(id) {
        await FunMap.Owner.Model.deleteFarm(id);
        FunMap.Utils.toast('Farm deleted.', 'success');
        await this.refreshList();
    },

    async _runReport(id) {
        const farm = await FunMap.Owner.Model.getFarm(id);
        if (!farm) return;
        const month = new Date().toISOString().substring(0, 7);
        FunMap.Utils.showLoading('RUNNING ASSESSMENT...');
        try {
            const assessment = await FunMap.Owner.Assessment.run(farm, month,
                s => FunMap.Utils.showLoading(s.toUpperCase()));
            FunMap.Utils.hideLoading();
            FunMap.Utils.toast(`Report ready — ${assessment.flags.length} flag${assessment.flags.length !== 1 ? 's' : ''}.`,
                assessment.flags.length ? 'warning' : 'success');
            await this.refreshList();
            this.openViewer(id);
        } catch (err) {
            FunMap.Utils.hideLoading();
            console.error('Owner report error:', err);
            FunMap.Utils.toast('Report failed: ' + err.message, 'error');
        }
    },

    // ---- Viewer ----

    _viewerUrls: null,

    async openViewer(farmId, assessmentId) {
        const farm = await FunMap.Owner.Model.getFarm(farmId);
        if (!farm) return;
        const useId = assessmentId || farm.lastAssessmentId;
        if (!useId) return;
        const assessment = await FunMap.Owner.Assessment.getAssessment(useId);
        const firm = await FunMap.Owner.Model.ensureDefaultFirm();
        if (!assessment) return;

        if (this._viewerUrls) FunMap.Owner.Report.revoke(this._viewerUrls);
        this._viewerUrls = await FunMap.Owner.Report.imageUrls(firm, assessment);
        document.getElementById('owner-viewer-content').innerHTML =
            FunMap.Owner.Report.buildHTML(farm, firm, assessment, this._viewerUrls);

        const pdfBtn = document.getElementById('owner-viewer-pdf');
        pdfBtn.onclick = async () => {
            pdfBtn.disabled = true;
            try {
                const blob = await FunMap.Owner.Report.toPdfBlob(farm, firm, assessment);
                FunMap.Owner.Report.downloadBlob(blob,
                    `${farm.name.replace(/\W+/g, '_')}_${assessment.month}.pdf`);
            } catch (err) {
                FunMap.Utils.toast('PDF failed: ' + err.message, 'error');
            }
            pdfBtn.disabled = false;
        };

        document.getElementById('owner-viewer').classList.remove('hidden');
    },

    closeViewer() {
        document.getElementById('owner-viewer').classList.add('hidden');
        if (this._viewerUrls) { FunMap.Owner.Report.revoke(this._viewerUrls); this._viewerUrls = null; }
    },
};
