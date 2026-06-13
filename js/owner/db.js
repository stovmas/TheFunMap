/* ============================================
   OWNER REPORT - IndexedDB storage
   Stores: firms, farms, portfolios, timeseries,
   assessments, images (blobs), reports (PDF blobs)
   ============================================ */

FunMap.Owner = FunMap.Owner || {};

FunMap.Owner.DB = {
    _dbPromise: null,

    _open() {
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open('funmap_owner', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                const mk = (name, opts) => {
                    if (!db.objectStoreNames.contains(name)) return db.createObjectStore(name, opts);
                    return null;
                };
                mk('firms', { keyPath: 'id' });
                mk('farms', { keyPath: 'id' });
                mk('portfolios', { keyPath: 'id' });
                const ts = mk('timeseries', { keyPath: 'key' }); // key = farmId|date
                if (ts) ts.createIndex('farmId', 'farmId', { unique: false });
                const as = mk('assessments', { keyPath: 'id' });
                if (as) as.createIndex('farmId', 'farmId', { unique: false });
                mk('images', {});   // out-of-line string keys -> Blob
                mk('reports', {});  // out-of-line string keys -> Blob (PDF)
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return this._dbPromise;
    },

    async _tx(store, mode, fn) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, mode);
            const result = fn(tx.objectStore(store));
            tx.oncomplete = () => resolve(result && result._req ? result._req.result : result);
            tx.onerror = () => reject(tx.error);
        });
    },

    async put(store, value, key) {
        return this._tx(store, 'readwrite', s => { key !== undefined ? s.put(value, key) : s.put(value); });
    },

    async get(store, key) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const req = db.transaction(store, 'readonly').objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
            req.onerror = () => reject(req.error);
        });
    },

    async getAll(store) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const req = db.transaction(store, 'readonly').objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    async getAllByIndex(store, indexName, value) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const idx = db.transaction(store, 'readonly').objectStore(store).index(indexName);
            const req = idx.getAll(value);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    async delete(store, key) {
        return this._tx(store, 'readwrite', s => { s.delete(key); });
    },

    async deleteMany(store, keys) {
        if (!keys || keys.length === 0) return;
        return this._tx(store, 'readwrite', s => { keys.forEach(k => s.delete(k)); });
    },
};
