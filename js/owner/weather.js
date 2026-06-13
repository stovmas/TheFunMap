/* ============================================
   OWNER REPORT - Weather context (Open-Meteo)
   Month precipitation total + departure from
   normal (ERA5 archive, free, no key).
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.Weather = {
    /** Sum daily precip (inches) for [start, end] at a point */
    async _precipSumInches(lat, lng, start, end) {
        const C = FunMap.Owner.Config;
        const url = `${C.weatherEndpoint}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
            `&start_date=${start}&end_date=${end}&daily=precipitation_sum&timezone=auto`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Weather API error: ' + resp.status);
        const data = await resp.json();
        const days = (data.daily && data.daily.precipitation_sum) || [];
        const mm = days.reduce((s, v) => s + (v || 0), 0);
        return { inches: mm / 25.4, dates: (data.daily && data.daily.time) || [] };
    },

    /**
     * Per-calendar-month normals (inches), computed once from the
     * configured climatology years and cached on the farm record.
     */
    async getNormals(farm) {
        if (farm.weatherNormals) return farm.weatherNormals;
        const C = FunMap.Owner.Config;
        const [y0, y1] = C.weatherNormalYears;
        const [lng, lat] = farm.centroid;

        // One bulk request for the climatology window; aggregate per month
        const url = `${C.weatherEndpoint}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
            `&start_date=${y0}-01-01&end_date=${y1}-12-31&daily=precipitation_sum&timezone=auto`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Weather API error: ' + resp.status);
        const data = await resp.json();
        const time = data.daily.time, precip = data.daily.precipitation_sum;

        const totals = {};
        for (let i = 0; i < time.length; i++) {
            const ym = time[i].substring(0, 7);            // YYYY-MM
            totals[ym] = (totals[ym] || 0) + (precip[i] || 0);
        }
        const byMonth = {};
        Object.keys(totals).forEach(ym => {
            const m = parseInt(ym.split('-')[1], 10);
            (byMonth[m] = byMonth[m] || []).push(totals[ym]);
        });
        const normals = {};
        Object.keys(byMonth).forEach(m => {
            const arr = byMonth[m];
            normals[m] = (arr.reduce((s, v) => s + v, 0) / arr.length) / 25.4;
        });

        farm.weatherNormals = normals;
        await FunMap.Owner.DB.put('farms', farm);
        return normals;
    },

    /**
     * Weather block for a report month ("YYYY-MM"):
     * { monthPrecipIn, normalIn, departureIn }
     */
    async monthContext(farm, monthStr) {
        const [lng, lat] = farm.centroid;
        const [y, m] = monthStr.split('-').map(Number);
        const start = `${monthStr}-01`;
        const endDay = new Date(y, m, 0).getDate();
        const today = new Date();
        const isCurrent = today.getFullYear() === y && (today.getMonth() + 1) === m;
        // ERA5 archive lags a few days; clamp the window accordingly
        const clamp = new Date(today.getTime() - 6 * 86400000);
        const end = isCurrent
            ? FunMap.Utils.toISODate(clamp < new Date(start) ? new Date(start) : clamp)
            : `${monthStr}-${String(endDay).padStart(2, '0')}`;

        const actual = await this._precipSumInches(lat, lng, start, end);
        const normals = await this.getNormals(farm);
        const normalIn = normals[m] || 0;

        return {
            monthPrecipIn: Math.round(actual.inches * 10) / 10,
            normalIn: Math.round(normalIn * 10) / 10,
            departureIn: Math.round((actual.inches - normalIn) * 10) / 10,
            partialMonth: isCurrent,
        };
    },
};
