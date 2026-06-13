/* ============================================
   OWNER REPORT - GeoJSON import + seed parcel
   Accepts a single Feature, a FeatureCollection,
   or a bare Polygon/MultiPolygon geometry.
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Importer = {
    /**
     * Parse GeoJSON text into farm specs:
     * [{ name, ring }] — one per polygon found.
     * MultiPolygon parts become separate farms (part suffix).
     */
    parseGeoJSON(text) {
        let gj;
        try { gj = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON'); }

        const features = gj.type === 'FeatureCollection' ? (gj.features || [])
            : gj.type === 'Feature' ? [gj]
            : (gj.type === 'Polygon' || gj.type === 'MultiPolygon')
                ? [{ type: 'Feature', properties: {}, geometry: gj }]
                : null;
        if (!features) throw new Error('Expected Feature, FeatureCollection, or Polygon geometry');

        const specs = [];
        features.forEach((f, i) => {
            const g = f.geometry;
            if (!g) return;
            const props = f.properties || {};
            const baseName = props.name || props.NAME || props.Name ||
                props.farm || props.FARM || `Imported parcel ${i + 1}`;
            if (g.type === 'Polygon') {
                specs.push({ name: baseName, ring: this._cleanRing(g.coordinates[0]), props });
            } else if (g.type === 'MultiPolygon') {
                g.coordinates.forEach((poly, j) => {
                    const suffix = g.coordinates.length > 1 ? ` (part ${j + 1})` : '';
                    specs.push({ name: baseName + suffix, ring: this._cleanRing(poly[0]), props });
                });
            }
        });

        if (specs.length === 0) throw new Error('No polygon features found');
        return specs;
    },

    _cleanRing(coords) {
        // Drop closing duplicate + any altitude values
        const ring = coords.map(c => [c[0], c[1]]);
        const a = ring[0], b = ring[ring.length - 1];
        if (ring.length > 3 && a[0] === b[0] && a[1] === b[1]) ring.pop();
        return ring;
    },

    /** Import farms from GeoJSON text; returns created farms */
    async importText(text) {
        const specs = this.parseGeoJSON(text);
        const created = [];
        for (const spec of specs) {
            const farm = await FunMap.Owner.Model.createFarm({
                name: spec.name,
                ring: spec.ring,
                cropType: (spec.props && (spec.props.crop || spec.props.CROP)) || '',
            });
            created.push(farm);
        }
        return created;
    },

    /**
     * Seed: 168 Moby Road, Delano TN (Polk County) — ~24.6 ac soybean.
     * DRAFT boundary approximated around the parcel centroid; the true
     * wedge between Moby Rd and the Hiwassee River must be corrected by
     * redrawing (EDIT > redraw) or importing parcel GeoJSON.
     */
    MOBY_ROAD_DRAFT_RING: [
        [-84.6479, 35.2102],
        [-84.6443, 35.2102],
        [-84.6440, 35.2087],
        [-84.6452, 35.2069],
        [-84.6466, 35.2068],
        [-84.6480, 35.2087],
    ],

    async seedMobyRoadFarm() {
        const existing = await FunMap.Owner.Model.getFarms();
        if (existing.some(f => f.name === 'Moby Road Farm')) {
            return existing.find(f => f.name === 'Moby Road Farm');
        }
        return FunMap.Owner.Model.createFarm({
            name: 'Moby Road Farm',
            nickname: '168 Moby Road',
            ring: this.MOBY_ROAD_DRAFT_RING.map(c => c.slice()),
            cropType: 'soybean',
            county: 'Polk',
            state: 'Tennessee',
            notes: 'DRAFT boundary — redraw to the true parcel wedge between Moby Rd and the Hiwassee River.',
            isDraft: true,
        });
    },
};
