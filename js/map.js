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

        // Create map
        this.map = L.map('map', {
            center: defaults.mapCenter,
            zoom: defaults.mapZoom,
            zoomControl: true,
            attributionControl: true,
            maxZoom: 18,
            minZoom: 2,
            worldCopyJump: true,
        });

        // Create base layers
        Object.entries(cfg.BaseMaps).forEach(([key, bm]) => {
            this.baseLayers[key] = L.tileLayer(bm.url, {
                attribution: bm.attribution,
                maxZoom: 19,
            });
        });

        // Add default base layer
        const savedBase = FunMap.Settings.get('basemap', 'dark');
        this.currentBase = savedBase;
        if (this.baseLayers[savedBase]) {
            this.baseLayers[savedBase].addTo(this.map);
        } else {
            this.baseLayers.dark.addTo(this.map);
        }

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
        return this.map.getZoom();
    },

    flyTo(lat, lng, zoom) {
        this.map.flyTo([lat, lng], zoom || 12, { duration: 1.5 });
    },

    fitBounds(bounds) {
        this.map.fitBounds(bounds, { padding: [50, 50] });
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
