/* ============================================
   THE FUN MAP - Utilities
   ============================================ */

FunMap.Utils = {
    // Toast notifications
    toast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        const icons = {
            success: '✓',
            error: '✗',
            warning: '⚠',
            info: 'ℹ',
        };
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // Show/hide loading overlay
    showLoading(text = 'LOADING...') {
        const overlay = document.getElementById('loading-overlay');
        document.getElementById('loading-text').textContent = text;
        overlay.classList.remove('hidden');
    },

    hideLoading() {
        document.getElementById('loading-overlay').classList.add('hidden');
    },

    // Status bar message
    setStatus(msg) {
        document.getElementById('status-message').textContent = msg;
    },

    // Format coordinates
    formatCoords(lat, lng, precision = 4) {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lngDir = lng >= 0 ? 'E' : 'W';
        return `${Math.abs(lat).toFixed(precision)}°${latDir}, ${Math.abs(lng).toFixed(precision)}°${lngDir}`;
    },

    // Format distance
    formatDistance(meters) {
        if (meters < 1000) return `${meters.toFixed(0)} m`;
        return `${(meters / 1000).toFixed(2)} km`;
    },

    // Format area
    formatArea(sqMeters) {
        if (sqMeters < 1e6) return `${sqMeters.toFixed(0)} m²`;
        return `${(sqMeters / 1e6).toFixed(2)} km²`;
    },

    // Format date for display
    formatDate(dateStr) {
        if (!dateStr) return '--';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    },

    // Format date for API (YYYY-MM-DD)
    toISODate(date) {
        if (typeof date === 'string') date = new Date(date);
        return date.toISOString().split('T')[0];
    },

    // Get date N days ago
    daysAgo(n) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return this.toISODate(d);
    },

    // Parse CSV to array of objects
    parseCSV(csv) {
        const lines = csv.trim().split('\n');
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const vals = this._splitCSVLine(lines[i]);
            if (vals.length !== headers.length) continue;
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = vals[idx];
            });
            rows.push(row);
        }
        return rows;
    },

    _splitCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        result.push(current.trim());
        return result;
    },

    // Haversine distance between two lat/lng points (meters)
    haversine(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    // Calculate polygon area (Shoelace formula on projected coords, approximate)
    polygonArea(latlngs) {
        if (latlngs.length < 3) return 0;
        // Simple spherical excess method
        const toRad = Math.PI / 180;
        let total = 0;
        for (let i = 0; i < latlngs.length; i++) {
            const j = (i + 1) % latlngs.length;
            total += (latlngs[j].lng - latlngs[i].lng) * toRad *
                     (2 + Math.sin(latlngs[i].lat * toRad) + Math.sin(latlngs[j].lat * toRad));
        }
        return Math.abs(total * 6371000 * 6371000 / 2);
    },

    // Debounce
    debounce(fn, ms) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
    },

    // Throttle
    throttle(fn, ms) {
        let lastCall = 0;
        return function (...args) {
            const now = Date.now();
            if (now - lastCall >= ms) {
                lastCall = now;
                fn.apply(this, args);
            }
        };
    },

    // Generate unique ID
    uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    // Clamp value
    clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    },

    // Create a colored circle icon for Leaflet markers
    circleIcon(color, size = 10) {
        return L.divIcon({
            className: '',
            html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:1px solid rgba(255,255,255,0.3);box-shadow:0 0 4px ${color};"></div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
        });
    },

    // Create pin icon
    pinIcon(color) {
        return L.divIcon({
            className: '',
            html: `<div style="
                width:20px;height:20px;
                background:${color};
                border:2px solid rgba(255,255,255,0.8);
                border-radius:50% 50% 50% 0;
                transform:rotate(-45deg);
                box-shadow:0 0 8px ${color};
            "></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 20],
            popupAnchor: [0, -20],
        });
    },

    // Fire color scale
    fireColor(confidence) {
        const c = parseFloat(confidence) || 0;
        if (typeof confidence === 'string') {
            if (confidence === 'high' || confidence === 'h') return '#ff0000';
            if (confidence === 'nominal' || confidence === 'n') return '#ff8800';
            if (confidence === 'low' || confidence === 'l') return '#ffcc00';
        }
        if (c >= 80) return '#ff0000';
        if (c >= 50) return '#ff6600';
        if (c >= 30) return '#ff9900';
        return '#ffcc00';
    },

    // FRP color scale
    frpColor(frp) {
        const v = parseFloat(frp) || 0;
        if (v > 500) return '#ff0000';
        if (v > 100) return '#ff4400';
        if (v > 50) return '#ff8800';
        if (v > 10) return '#ffaa00';
        return '#ffcc00';
    },

    // Brightness color scale
    brightnessColor(brightness) {
        const v = parseFloat(brightness) || 0;
        if (v > 400) return '#ff0000';
        if (v > 350) return '#ff4400';
        if (v > 320) return '#ff8800';
        if (v > 300) return '#ffaa00';
        return '#ffcc00';
    },

    // Build popup HTML table
    popupTable(title, rows) {
        let html = `<div class="popup-content"><h4>${title}</h4><table>`;
        rows.forEach(([label, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                html += `<tr><td>${label}</td><td>${value}</td></tr>`;
            }
        });
        html += '</table></div>';
        return html;
    },

    // Update feature info panel
    showFeatureInfo(title, rows) {
        const panel = document.getElementById('feature-info');
        let html = `<div class="info-title">${title}</div><table>`;
        rows.forEach(([label, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                html += `<tr><td>${label}</td><td>${value}</td></tr>`;
            }
        });
        html += '</table>';
        panel.innerHTML = html;
    },

    // Bbox from Leaflet bounds
    bboxFromBounds(bounds) {
        return [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
        ];
    },

    // Leaflet bounds from bbox array [west, south, east, north]
    boundsFromBbox(bbox) {
        return L.latLngBounds(
            L.latLng(bbox[1], bbox[0]),
            L.latLng(bbox[3], bbox[2])
        );
    },
};
