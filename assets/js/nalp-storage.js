(function (global) {
  'use strict';

  const DB_NAME = 'nalp_solar_assets_v1';
  const STORE_NAME = 'files';
  const SETTINGS_KEY = 'nalp_solar_settings_v1';

  const PLAN_KEYS = ['bohren', 'stahlbau', 'bestellung', 'stapel'];

  function defaultSettings() {
    return {
      active5wFileId: null,
      planFiles: {
        bohren: null,
        stahlbau: null,
        bestellung: null,
        stapel: null
      },
      geojsonIds: []
    };
  }

  function normalizeSettings(raw) {
    const base = defaultSettings();
    const value = raw && typeof raw === 'object' ? raw : {};

    const planFiles = value.planFiles && typeof value.planFiles === 'object' ? value.planFiles : {};
    PLAN_KEYS.forEach((key) => {
      base.planFiles[key] = typeof planFiles[key] === 'string' ? planFiles[key] : null;
    });

    base.active5wFileId = typeof value.active5wFileId === 'string' ? value.active5wFileId : null;
    base.geojsonIds = Array.isArray(value.geojsonIds)
      ? value.geojsonIds.filter((id) => typeof id === 'string')
      : [];

    return base;
  }

  function getSettings() {
    try {
      const raw = global.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaultSettings();
      return normalizeSettings(JSON.parse(raw));
    } catch (err) {
      return defaultSettings();
    }
  }

  function setSettings(next) {
    const normalized = normalizeSettings(next);
    global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function updateSettings(updater) {
    const current = getSettings();
    const updated = updater(current);
    return setSettings(updated);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = global.indexedDB.open(DB_NAME, 1);

      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('kind', 'kind', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      req.onsuccess = function () {
        resolve(req.result);
      };

      req.onerror = function () {
        reject(req.error || new Error('IndexedDB konnte nicht geoeffnet werden'));
      };
    });
  }

  async function withStore(mode, handler) {
    const db = await openDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);

      tx.oncomplete = function () {
        db.close();
      };

      tx.onerror = function () {
        reject(tx.error || new Error('IndexedDB-Transaktion fehlgeschlagen'));
      };

      tx.onabort = function () {
        reject(tx.error || new Error('IndexedDB-Transaktion abgebrochen'));
      };

      handler(store, resolve, reject);
    });
  }

  function safeFileName(file) {
    return String(file?.name || 'datei').replace(/\s+/g, '_');
  }

  async function saveFile(file, meta) {
    if (!(file instanceof global.File) && !(file instanceof global.Blob)) {
      throw new Error('Ungueltige Datei');
    }

    const info = meta || {};
    const id = typeof info.id === 'string'
      ? info.id
      : (String(info.kind || 'file') + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8) + ':' + safeFileName(file));

    const record = {
      id,
      kind: String(info.kind || 'file'),
      label: String(info.label || file.name || id),
      name: String(info.name || file.name || 'datei'),
      mimeType: String(info.mimeType || file.type || ''),
      size: Number.isFinite(file.size) ? file.size : 0,
      updatedAt: new Date().toISOString(),
      blob: file
    };

    await withStore('readwrite', (store, resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = function () { resolve(record); };
      req.onerror = function () { reject(req.error || new Error('Datei konnte nicht gespeichert werden')); };
    });

    return record;
  }

  async function getFile(id) {
    if (!id) return null;
    return withStore('readonly', (store, resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error || new Error('Datei konnte nicht gelesen werden')); };
    });
  }

  async function deleteFile(id) {
    if (!id) return;
    await withStore('readwrite', (store, resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error || new Error('Datei konnte nicht geloescht werden')); };
    });
  }

  async function listFilesByKind(kind) {
    return withStore('readonly', (store, resolve, reject) => {
      const index = store.index('kind');
      const req = index.getAll(String(kind || ''));
      req.onsuccess = function () {
        const rows = Array.isArray(req.result) ? req.result.slice() : [];
        rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        resolve(rows);
      };
      req.onerror = function () { reject(req.error || new Error('Dateien konnten nicht geladen werden')); };
    });
  }

  global.NalpStorage = {
    PLAN_KEYS,
    getSettings,
    setSettings,
    updateSettings,
    saveFile,
    getFile,
    deleteFile,
    listFilesByKind
  };
})(window);
