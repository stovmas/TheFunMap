/* ============================================
   OWNER REPORT - Report image rendering (canvas)
   - Hero: truecolor PNG + farm boundary stroke
   - Anomaly: NDVI colormap + flagged clusters
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Render = {
    _project(lng, lat, bbox, w, h) {
        return [
            (lng - bbox[0]) / (bbox[2] - bbox[0]) * w,
            (bbox[3] - lat) / (bbox[3] - bbox[1]) * h,
        ];
    },

    _strokeRing(ctx, ring, bbox, w, h, color, lineWidth) {
        ctx.beginPath();
        ring.forEach(([lng, lat], i) => {
            const [x, y] = this._project(lng, lat, bbox, w, h);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    },

    async _blobToImage(blob) {
        const url = URL.createObjectURL(blob);
        try {
            return await new Promise((res, rej) => {
                const img = new Image();
                img.onload = () => res(img);
                img.onerror = () => rej(new Error('Could not decode image'));
                img.src = url;
            });
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
    },

    _toBlob(canvas) {
        return new Promise(res => canvas.toBlob(res, 'image/png'));
    },

    /** Truecolor hero with the farm boundary drawn on top */
    async heroImage(pngBlob, ring, bbox) {
        const img = await this._blobToImage(pngBlob);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        this._strokeRing(ctx, ring, bbox, canvas.width, canvas.height, 'rgba(0,0,0,0.55)', 4);
        this._strokeRing(ctx, ring, bbox, canvas.width, canvas.height, '#ffd84d', 2.5);
        return this._toBlob(canvas);
    },

    /** NDVI green colormap value for v in [-0.2, 0.95] */
    _ndviColor(v) {
        const t = Math.max(0, Math.min(1, (v + 0.2) / 1.15));
        if (t < 0.35) {           // bare / water: browns
            const u = t / 0.35;
            return [150 + 50 * u, 110 + 50 * u, 70 + 30 * u];
        }
        const u = (t - 0.35) / 0.65;  // vegetation: yellow-green -> deep green
        return [180 - 150 * u, 190 - 60 * u, 70 - 30 * u];
    },

    /**
     * Anomaly overlay: upscaled raster heatmap.
     * raster: { data, width, height, bbox }; flags from Anomaly.detect.
     */
    async anomalyOverlay(raster, mask, flags, ring) {
        const { data, width, height, bbox } = raster;
        const scale = Math.max(4, Math.round(640 / Math.max(width, height)));
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1d2a1d';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const flagged = new Uint8Array(width * height);
        flags.forEach(f => f.pixels.forEach(i => { flagged[i] = f.severity === 'severe' ? 3 : f.severity === 'moderate' ? 2 : 1; }));

        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                const i = r * width + c;
                if (!mask[i]) continue;
                let rgb;
                if (isNaN(data[i])) {
                    rgb = [70, 70, 70];                       // masked (cloud) pixel
                } else if (flagged[i]) {
                    rgb = flagged[i] === 3 ? [220, 40, 30]    // severe
                        : flagged[i] === 2 ? [235, 110, 30]   // moderate
                        : [240, 180, 40];                     // minor
                } else {
                    rgb = this._ndviColor(data[i]);
                }
                ctx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
                ctx.fillRect(c * scale, r * scale, scale, scale);
            }
        }

        // Boundary + flag outlines
        this._strokeRing(ctx, ring, bbox, canvas.width, canvas.height, 'rgba(255,255,255,0.85)', 2);
        ctx.font = `bold ${Math.max(12, scale * 2.5)}px sans-serif`;
        flags.forEach((f, idx) => {
            const [x, y] = this._project(f.centerLngLat[0], f.centerLngLat[1], bbox, canvas.width, canvas.height);
            ctx.beginPath();
            ctx.arc(x, y, Math.max(10, scale * 2), 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(idx + 1), x + Math.max(12, scale * 2) + 2, y + 4);
        });

        return this._toBlob(canvas);
    },
};
