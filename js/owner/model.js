/* ============================================
   OWNER REPORT - Farm / Firm data model
   Every record carries firmId for future
   multi-tenancy; v1 uses the 'default' firm.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Model = {
    DEFAULT_FIRM_ID: 'default',

    async ensureDefaultFirm() {
        const DB = FunMap.Owner.DB;
        let firm = await DB.get('firms', this.DEFAULT_FIRM_ID);
        if (!firm) {
            firm = {
                id: this.DEFAULT_FIRM_ID,
                displayName: 'Demo Land Management',
                accentColor: '#2e6e3e',
                footerLine: 'Questions? Contact your farm manager.',
                logoKey: null,            // images-store key for uploaded logo
                createdAt: new Date().toISOString(),
            };
            await DB.put('firms', firm);
        }
        return firm;
    },

    /**
     * Create a farm from a boundary ring ([[lng,lat],...]).
     * Computes acreage, buffered analysis geometry, centroid.
     */
    async createFarm(opts) {
        const G = FunMap.Owner.Geometry;
        const C = FunMap.Owner.Config;
        const ring = opts.ring;
        if (!ring || ring.length < 3) throw new Error('Farm boundary needs at least 3 points');

        const buffered = G.erodePolygon(ring, C.edgeBufferMeters);
        const farm = {
            id: FunMap.Utils.uid(),
            firmId: this.DEFAULT_FIRM_ID,
            portfolioId: null,
            name: opts.name || 'Unnamed Farm',
            nickname: opts.nickname || '',
            ownerDisplayName: opts.ownerDisplayName || '',
            cropType: opts.cropType || '',
            notes: opts.notes || '',
            county: opts.county || '',
            state: opts.state || '',
            ring: ring,                    // display geometry
            bufferedRing: buffered,        // analysis geometry
            centroid: G.centroid(ring),
            acreage: Math.round(G.acres(ring) * 10) / 10,
            comparisonRings: [],           // neighbor benchmark polygons
            isDraft: !!opts.isDraft,       // boundary needs user verification
            weatherNormals: null,          // monthIdx(1-12) -> normal inches
            backfilledTo: null,            // last date covered by timeseries
            lastAssessmentId: null,
            createdAt: new Date().toISOString(),
        };
        await FunMap.Owner.DB.put('farms', farm);
        this._reverseGeocode(farm);        // fills county/state async
        return farm;
    },

    async updateFarm(farm) {
        // Recompute derived fields in case geometry changed
        const G = FunMap.Owner.Geometry;
        const C = FunMap.Owner.Config;
        farm.bufferedRing = G.erodePolygon(farm.ring, C.edgeBufferMeters);
        farm.centroid = G.centroid(farm.ring);
        farm.acreage = Math.round(G.acres(farm.ring) * 10) / 10;
        await FunMap.Owner.DB.put('farms', farm);
        return farm;
    },

    async getFarms() {
        const farms = await FunMap.Owner.DB.getAll('farms');
        return farms.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getFarm(id) {
        return FunMap.Owner.DB.get('farms', id);
    },

    async deleteFarm(id) {
        const DB = FunMap.Owner.DB;
        // Remove dependent rows
        const ts = await DB.getAllByIndex('timeseries', 'farmId', id);
        await DB.deleteMany('timeseries', ts.map(r => r.key));
        const assessments = await DB.getAllByIndex('assessments', 'farmId', id);
        const imgKeys = [];
        assessments.forEach(a => {
            if (a.images) Object.values(a.images).forEach(k => k && imgKeys.push(k));
        });
        await DB.deleteMany('images', imgKeys);
        await DB.deleteMany('reports', assessments.map(a => 'pdf|' + a.id));
        await DB.deleteMany('assessments', assessments.map(a => a.id));
        await DB.delete('farms', id);
    },

    async _reverseGeocode(farm) {
        if (farm.county) return;
        try {
            const [lng, lat] = farm.centroid;
            const resp = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=8`,
                { headers: { 'Accept-Language': 'en' } });
            if (!resp.ok) return;
            const data = await resp.json();
            const a = data.address || {};
            farm.county = (a.county || '').replace(/ County$/i, '');
            farm.state = a.state || '';
            await FunMap.Owner.DB.put('farms', farm);
            if (FunMap.Owner.UI) FunMap.Owner.UI.refreshList();
        } catch (e) { /* manual entry remains available */ }
    },
};
