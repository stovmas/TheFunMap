/* ============================================
   OWNER REPORT - Geometry helpers
   Farm geometry is stored as a GeoJSON Polygon
   ring: [[lng,lat], ...] (closed not required).
   Pure math here is Node-testable; only
   erodePolygon needs Turf (browser CDN).
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Geometry = {
    /** Spherical polygon area in m² (ring of [lng,lat]) */
    ringAreaM2(ring) {
        if (!ring || ring.length < 3) return 0;
        const R = 6371000, toRad = Math.PI / 180;
        let total = 0;
        for (let i = 0; i < ring.length; i++) {
            const [lng1, lat1] = ring[i];
            const [lng2, lat2] = ring[(i + 1) % ring.length];
            total += (lng2 - lng1) * toRad *
                (2 + Math.sin(lat1 * toRad) + Math.sin(lat2 * toRad));
        }
        return Math.abs(total * R * R / 2);
    },

    acres(ring) {
        return this.ringAreaM2(ring) * 0.000247105;
    },

    centroid(ring) {
        let lng = 0, lat = 0;
        ring.forEach(p => { lng += p[0]; lat += p[1]; });
        return [lng / ring.length, lat / ring.length];
    },

    bbox(ring, padDeg = 0) {
        let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
        ring.forEach(([lng, lat]) => {
            if (lng < w) w = lng; if (lng > e) e = lng;
            if (lat < s) s = lat; if (lat > n) n = lat;
        });
        return [w - padDeg, s - padDeg, e + padDeg, n + padDeg];
    },

    /** Ray-casting point-in-polygon. pt = [lng,lat] */
    pointInRing(pt, ring) {
        const [x, y] = pt;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if ((yi > y) !== (yj > y) &&
                x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) {
                inside = !inside;
            }
        }
        return inside;
    },

    /** Inward erosion via Turf (browser). Falls back to original on failure. */
    erodePolygon(ring, meters) {
        try {
            const poly = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [this.closeRing(ring)] } };
            const out = turf.buffer(poly, -meters / 1000, { units: 'kilometers' });
            if (!out || !out.geometry) return ring.slice();
            const g = out.geometry;
            const shell = g.type === 'Polygon' ? g.coordinates[0]
                : g.type === 'MultiPolygon' ? g.coordinates
                    .map(p => p[0])
                    .sort((a, b) => this.ringAreaM2(b) - this.ringAreaM2(a))[0]
                : null;
            return (shell && shell.length >= 4) ? shell : ring.slice();
        } catch (e) {
            return ring.slice();
        }
    },

    closeRing(ring) {
        const r = ring.slice();
        const [a, b] = [r[0], r[r.length - 1]];
        if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
        return r;
    },

    /** GeoJSON ring [[lng,lat]] -> Leaflet [[lat,lng]] */
    toLeaflet(ring) { return ring.map(([lng, lat]) => [lat, lng]); },
    fromLeaflet(latlngs) { return latlngs.map(([lat, lng]) => [lng, lat]); },

    /**
     * Compass phrase for a point relative to the farm.
     * "center" when within 30% of the farm's radius.
     */
    compassPosition(pt, ring) {
        const c = this.centroid(ring);
        const box = this.bbox(ring);
        const midLat = (box[1] + box[3]) / 2;
        const cosLat = Math.cos(midLat * Math.PI / 180);
        const dx = (pt[0] - c[0]) * cosLat;
        const dy = pt[1] - c[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = Math.max((box[2] - box[0]) * cosLat, box[3] - box[1]) / 2;
        if (radius <= 0 || dist < radius * 0.3) return 'center of the field';
        const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        const names = ['northern edge', 'northeast corner', 'eastern edge', 'southeast corner',
            'southern edge', 'southwest corner', 'western edge', 'northwest corner'];
        return names[Math.round(deg / 45) % 8];
    },

    /**
     * Pixel-grid helpers: a farm raster is a north-up grid over `bbox`
     * [w,s,e,n] with `width` x `height` pixels. Row 0 = north.
     */
    pixelCenterLngLat(col, row, bbox, width, height) {
        const lng = bbox[0] + (col + 0.5) * (bbox[2] - bbox[0]) / width;
        const lat = bbox[3] - (row + 0.5) * (bbox[3] - bbox[1]) / height;
        return [lng, lat];
    },

    /** Boolean mask (Uint8Array w*h): pixel center inside ring */
    rasterMask(ring, bbox, width, height) {
        const mask = new Uint8Array(width * height);
        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                if (this.pointInRing(this.pixelCenterLngLat(c, r, bbox, width, height), ring)) {
                    mask[r * width + c] = 1;
                }
            }
        }
        return mask;
    },

    /** Approximate m² of one pixel in this grid */
    pixelAreaM2(bbox, width, height) {
        const midLat = (bbox[1] + bbox[3]) / 2;
        const mPerDegLat = 111320;
        const mPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
        const pw = (bbox[2] - bbox[0]) / width * mPerDegLng;
        const ph = (bbox[3] - bbox[1]) / height * mPerDegLat;
        return pw * ph;
    },
};
