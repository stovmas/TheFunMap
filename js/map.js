/* ============================================
   THE FUN MAP - Map Engine
   ============================================ */

FunMap.Map = {
    map: null,
    baseLayers: {},
    currentBase: 'dark',
    overlayLayers: {},

    init() {
        const cfg = FunMap.Config;
        const defaults = cfg.Defaults;

        // Create map with optimized rendering
        this.map = L.map('map', {
            center: defaults.mapCenter,
            zoom: defaults.mapZoom,
            zoomControl: true,
            attributionControl: true,
            maxZoom: 18,
            minZoom: 2,
            worldCopyJump: true,
            preferCanvas: true,           // Canvas renderer for better marker performance
            zoomSnap: 0.5,               // Smoother zoom increments
            wheelPxPerZoomLevel: 120,    // Smoother scroll zoom
        });

        // Create base layers with optimized loading
        Object.entries(cfg.BaseMaps).forEach(([key, bm]) => {
            const opts = {
                attribution: bm.attribution,
                maxZoom: 19,
                updateWhenZooming: false,  // Don't load tiles during zoom animation
                updateWhenIdle: true,      // Wait until pan/zoom stops to load
                keepBuffer: 2,             // Keep 2 tile-lengths of buffer around viewport
            };
            // Apply Xbox-themed class to dark tiles
            if (bm.className) {
                opts.className = bm.className;
            }
            this.baseLayers[key] = L.tileLayer(bm.url, opts);
        });

        // Add default base layer
        const savedBase = FunMap.Settings.get('basemap', 'dark');
        this.currentBase = savedBase;
        if (this.baseLayers[savedBase]) {
            this.baseLayers[savedBase].addTo(this.map);
        } else {
            this.baseLayers.dark.addTo(this.map);
        }

        // Ensure dark tiles class is applied (fallback for className option)
        this._applyDarkTileClass();

        // Set radio button
        const radio = document.querySelector(`input[name="basemap"][value="${savedBase}"]`);
        if (radio) radio.checked = true;

        // Scale control
        L.control.scale({
            position: 'bottomleft',
            imperial: false,
            maxWidth: 200,
        }).addTo(this.map);

        // Map events
        this.map.on('mousemove', FunMap.Utils.throttle((e) => {
            document.getElementById('cursor-coords').textContent =
                FunMap.Utils.formatCoords(e.latlng.lat, e.latlng.lng);
        }, 50));

        this.map.on('zoomend', () => {
            const zoom = this.map.getZoom();
            document.getElementById('zoom-level').textContent = Math.round(zoom);
            this._checkZoomLayers();
        });

        this.map.on('moveend', () => {
            this._onViewChange();
            this._checkBuildings();
        });

        // Right click for pin placement
        this.map.on('contextmenu', (e) => {
            FunMap.Pins.openPinDialog(e.latlng);
        });

        // Base map switching
        document.querySelectorAll('input[name="basemap"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.switchBase(e.target.value);
            });
        });

        // Initial zoom display
        document.getElementById('zoom-level').textContent = this.map.getZoom();
    },

    switchBase(key) {
        if (this.baseLayers[this.currentBase]) {
            this.map.removeLayer(this.baseLayers[this.currentBase]);
        }
        if (this.baseLayers[key]) {
            this.baseLayers[key].addTo(this.map);
            this.currentBase = key;
            FunMap.Settings.set('basemap', key);
        }
        // Ensure dark tiles class is applied
        this._applyDarkTileClass();
        // Check buildings visibility (only on Street/OSM map at high zoom)
        this._checkBuildings();
    },

    _applyDarkTileClass() {
        // Manually ensure the dark tile layer container has the Xbox class
        if (this.currentBase === 'dark' && this.baseLayers.dark) {
            const container = this.baseLayers.dark.getContainer();
            if (container && !container.classList.contains('dark-xbox-tiles')) {
                container.classList.add('dark-xbox-tiles');
            }
        }
    },

    _checkZoomLayers() {
        const zoom = this.map.getZoom();
        const minZoom = FunMap.Settings.get('sentinel_zoom', FunMap.Config.Defaults.sentinelMinZoom);
        const s2Active = document.getElementById('layer-sentinel2').checked;
        const s1Active = document.getElementById('layer-sentinel1').checked;

        const notice = document.getElementById('zoom-notice');
        const noticeLevel = document.getElementById('zoom-notice-level');

        if ((s2Active || s1Active) && zoom < minZoom) {
            noticeLevel.textContent = minZoom;
            notice.classList.remove('hidden');
        } else {
            notice.classList.add('hidden');
        }
    },

    _onViewChange() {
        // Refresh layers that depend on viewport
        if (this._viewChangeTimer) clearTimeout(this._viewChangeTimer);
        this._viewChangeTimer = setTimeout(() => {
            FunMap.Sentinel.onViewChange();
        }, 300);
    },

    getCenter() {
        return this.map.getCenter();
    },

    getBounds() {
        return this.map.getBounds();
    },

    getZoom() {
        return Math.round(this.map.getZoom());
    },

    flyTo(lat, lng, zoom) {
        this.map.flyTo([lat, lng], zoom || 12, { duration: 1.5 });
    },

    fitBounds(bounds) {
        this.map.fitBounds(bounds, { padding: [50, 50] });
    },

    // ---- Interactive Buildings (OSM via Overpass) ----
    _buildingsLayer: null,
    _buildingsLoading: false,
    _buildingsBounds: null,
    _buildingsMinZoom: 16,

    _checkBuildings() {
        const zoom = this.map.getZoom();
        if (this.currentBase === 'osm' && zoom >= this._buildingsMinZoom) {
            this._loadBuildings();
        } else if (this._buildingsLayer) {
            this.map.removeLayer(this._buildingsLayer);
            this._buildingsLayer = null;
            this._buildingsBounds = null;
        }
    },

    async _loadBuildings() {
        if (this._buildingsLoading) return;

        const bounds = this.map.getBounds();
        // Skip if we already loaded for roughly this area
        if (this._buildingsBounds) {
            const prev = this._buildingsBounds;
            if (prev.contains(bounds)) return;
        }

        this._buildingsLoading = true;
        FunMap.Utils.setStatus('LOADING BUILDINGS...');

        try {
            const s = bounds.getSouth();
            const w = bounds.getWest();
            const n = bounds.getNorth();
            const e = bounds.getEast();

            const query = `[out:json][timeout:15];way["building"](${s},${w},${n},${e});out body geom;`;
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: 'data=' + encodeURIComponent(query),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });

            if (!response.ok) throw new Error('Overpass API error');
            const data = await response.json();

            if (this._buildingsLayer) {
                this.map.removeLayer(this._buildingsLayer);
            }

            const features = [];
            (data.elements || []).forEach(el => {
                if (!el.geometry || el.geometry.length < 3) return;
                const coords = el.geometry.map(p => [p.lat, p.lng]);
                const poly = L.polygon(coords, {
                    color: 'var(--xbox-green, #87c540)',
                    weight: 1,
                    fillColor: '#87c540',
                    fillOpacity: 0.15,
                    className: 'building-polygon',
                });

                // Build popup with building info
                const tags = el.tags || {};
                const rows = [];
                if (tags.name) rows.push(['Name', tags.name]);
                rows.push(['Type', tags.building || 'yes']);
                if (tags['addr:street']) rows.push(['Street', tags['addr:street']]);
                if (tags['addr:housenumber']) rows.push(['Number', tags['addr:housenumber']]);
                if (tags['building:levels']) rows.push(['Levels', tags['building:levels']]);
                if (tags.amenity) rows.push(['Amenity', tags.amenity]);
                if (tags.shop) rows.push(['Shop', tags.shop]);
                if (tags.office) rows.push(['Office', tags.office]);
                rows.push(['OSM ID', `way/${el.id}`]);

                poly.bindPopup(FunMap.Utils.popupTable('BUILDING', rows));
                poly.on('click', () => {
                    FunMap.Utils.showFeatureInfo('BUILDING', rows);
                });
                features.push(poly);
            });

            this._buildingsLayer = L.layerGroup(features);
            this._buildingsLayer.addTo(this.map);
            this._buildingsBounds = bounds;
            this._buildingsLoading = false;

            FunMap.Utils.setStatus(`${features.length} BUILDINGS LOADED`);
        } catch (err) {
            this._buildingsLoading = false;
            console.warn('Buildings load error:', err);
            FunMap.Utils.setStatus('SYSTEMS ONLINE');
        }
    },

    // Count active overlay layers
    updateLayerCount() {
        let count = 0;
        if (document.getElementById('layer-sentinel2').checked) count++;
        if (document.getElementById('layer-sentinel1').checked) count++;
        if (document.getElementById('layer-firms').checked) count++;
        if (document.getElementById('layer-conflict').checked) count++;
        if (document.getElementById('layer-pins').checked) count++;
        document.getElementById('layer-count').textContent = `${count} layer${count !== 1 ? 's' : ''} active`;
    },
};
