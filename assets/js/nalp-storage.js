(function (global) {
  'use strict';

  var DB_NAME = 'nalp_solar_assets_v1';
  var STORE_NAME = 'files';
  var SETTINGS_KEY = 'nalp_solar_settings_v2';
  var SETTINGS_KEY_V1 = 'nalp_solar_settings_v1';

  var PLAN_KEYS = ['bohren', 'stahlbau', 'bestellung', 'stapel'];

  var GITHUB_OWNER = 'maltv';
  var GITHUB_REPO = 'website_nalpsolar';
  var GITHUB_BRANCH = 'main';

  // Fixed repo paths for IFC slots
  var IFC_REPO_PATHS = {
    wl:     'uploads/ifc/werkleitungen.ifc',
    erdung: 'uploads/ifc/erdung.ifc'
  };

  // Fixed repo paths for each PDF slot
  // Begleitplan-Slots (bohren/stahlbau/bestellung/stapel) am 18.08.2026 entfernt -
  // die Plaene waren Stand KW21-25 und sind nach _Archiv°818_Begleitplaene\ weg.
  var PDF_REPO_PATHS = {
    '5w': '5W-Programm/KW21-25.pdf'
  };

  // ── Settings (localStorage) ─────────────────────────────────────────────────

  function defaultSettings() {
    return {
      pdfMeta: { '5w': null },
      ifcMeta: { wl: null, erdung: null },
      geojsonIds: []
    };
  }

  function normalizeSettings(raw) {
    var base = defaultSettings();
    var value = raw && typeof raw === 'object' ? raw : {};

    var pm = value.pdfMeta && typeof value.pdfMeta === 'object' ? value.pdfMeta : {};
    ['5w'].concat(PLAN_KEYS).forEach(function (k) {
      var m = pm[k];
      base.pdfMeta[k] = (m && typeof m === 'object') ? m : null;
    });

    var im = value.ifcMeta && typeof value.ifcMeta === 'object' ? value.ifcMeta : {};
    base.ifcMeta.wl     = (im.wl     && typeof im.wl     === 'object') ? im.wl     : null;
    base.ifcMeta.erdung = (im.erdung && typeof im.erdung === 'object') ? im.erdung : null;

    base.geojsonIds = Array.isArray(value.geojsonIds)
      ? value.geojsonIds.filter(function (id) { return typeof id === 'string'; })
      : [];

    return base;
  }

  function migrateV1GeojsonIds() {
    try {
      if (global.localStorage.getItem(SETTINGS_KEY)) return; // v2 already exists
      var raw = global.localStorage.getItem(SETTINGS_KEY_V1);
      if (!raw) return;
      var v1 = JSON.parse(raw);
      if (v1 && Array.isArray(v1.geojsonIds) && v1.geojsonIds.length) {
        var base = defaultSettings();
        base.geojsonIds = v1.geojsonIds.filter(function (id) { return typeof id === 'string'; });
        global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(base));
      }
    } catch (e) { /* ignore */ }
  }

  migrateV1GeojsonIds();

  function getSettings() {
    try {
      var raw = global.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaultSettings();
      return normalizeSettings(JSON.parse(raw));
    } catch (e) {
      return defaultSettings();
    }
  }

  function setSettings(next) {
    var normalized = normalizeSettings(next);
    global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function updateSettings(updater) {
    return setSettings(updater(getSettings()));
  }

  // ── GitHub API ──────────────────────────────────────────────────────────────

  function ghHeaders(token) {
    return {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
  }

  function ghContentsUrl(path) {
    return 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + path;
  }

  async function getFileSha(path, token) {
    try {
      var res = await global.fetch(ghContentsUrl(path) + '?ref=' + GITHUB_BRANCH, {
        headers: ghHeaders(token)
      });
      if (!res.ok) return null;
      var data = await res.json();
      return data.sha || null;
    } catch (e) {
      return null;
    }
  }

  async function uploadPdfToGitHub(file, pathKey, token) {
    var path = PDF_REPO_PATHS[pathKey];
    if (!path) throw new Error('Unbekannter Slot: ' + pathKey);

    // Convert file to base64
    var base64 = await new Promise(function (resolve, reject) {
      var reader = new global.FileReader();
      reader.onload = function (e) { resolve(e.target.result.split(',')[1]); };
      reader.onerror = function () { reject(new Error('Datei konnte nicht gelesen werden')); };
      reader.readAsDataURL(file);
    });

    var sha = await getFileSha(path, token);

    var body = {
      message: 'PDF Upload: ' + file.name,
      content: base64,
      branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;

    var res = await global.fetch(ghContentsUrl(path), {
      method: 'PUT',
      headers: ghHeaders(token),
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error('GitHub ' + res.status + ': ' + (err.message || 'Unbekannter Fehler'));
    }

    return await res.json();
  }

  async function deletePdfFromGitHub(pathKey, token) {
    var path = PDF_REPO_PATHS[pathKey];
    if (!path) throw new Error('Unbekannter Slot: ' + pathKey);

    var sha = await getFileSha(path, token);
    if (!sha) return; // file not in repo, nothing to delete

    var res = await global.fetch(ghContentsUrl(path), {
      method: 'DELETE',
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: 'PDF entfernt: ' + path,
        sha: sha,
        branch: GITHUB_BRANCH
      })
    });

    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error('GitHub ' + res.status + ': ' + (err.message || 'Unbekannter Fehler'));
    }
  }

  async function uploadIfcToGitHub(file, slotKey, token) {
    var path = IFC_REPO_PATHS[slotKey];
    if (!path) throw new Error('Unbekannter IFC-Slot: ' + slotKey);

    var base64 = await new Promise(function (resolve, reject) {
      var reader = new global.FileReader();
      reader.onload = function (e) { resolve(e.target.result.split(',')[1]); };
      reader.onerror = function () { reject(new Error('Datei konnte nicht gelesen werden')); };
      reader.readAsDataURL(file);
    });

    var sha = await getFileSha(path, token);
    var body = { message: 'IFC Upload: ' + file.name, content: base64, branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;

    var res = await global.fetch(ghContentsUrl(path), {
      method: 'PUT',
      headers: ghHeaders(token),
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error('GitHub ' + res.status + ': ' + (err.message || 'Unbekannter Fehler'));
    }
    return await res.json();
  }

  async function deleteIfcFromGitHub(slotKey, token) {
    var path = IFC_REPO_PATHS[slotKey];
    if (!path) throw new Error('Unbekannter IFC-Slot: ' + slotKey);

    var sha = await getFileSha(path, token);
    if (!sha) return;

    var res = await global.fetch(ghContentsUrl(path), {
      method: 'DELETE',
      headers: ghHeaders(token),
      body: JSON.stringify({ message: 'IFC entfernt: ' + path, sha: sha, branch: GITHUB_BRANCH })
    });

    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error('GitHub ' + res.status + ': ' + (err.message || 'Unbekannter Fehler'));
    }
  }

  // ── IndexedDB (GeoJSON only) ────────────────────────────────────────────────

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('kind', 'kind', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB konnte nicht geoeffnet werden')); };
    });
  }

  async function withStore(mode, handler) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, mode);
      var store = tx.objectStore(STORE_NAME);
      tx.oncomplete = function () { db.close(); };
      tx.onerror = function () { reject(tx.error || new Error('Transaktion fehlgeschlagen')); };
      tx.onabort = function () { reject(tx.error || new Error('Transaktion abgebrochen')); };
      handler(store, resolve, reject);
    });
  }

  function safeFileName(file) {
    return String(file ? file.name : 'datei').replace(/\s+/g, '_');
  }

  async function saveFile(file, meta) {
    if (!(file instanceof global.File) && !(file instanceof global.Blob)) {
      throw new Error('Ungueltige Datei');
    }
    var info = meta || {};
    var id = typeof info.id === 'string'
      ? info.id
      : (String(info.kind || 'file') + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8) + ':' + safeFileName(file));

    var record = {
      id: id,
      kind: String(info.kind || 'file'),
      label: String(info.label || file.name || id),
      name: String(info.name || file.name || 'datei'),
      mimeType: String(info.mimeType || file.type || ''),
      size: Number.isFinite(file.size) ? file.size : 0,
      updatedAt: new Date().toISOString(),
      blob: file
    };

    await withStore('readwrite', function (store, resolve, reject) {
      var req = store.put(record);
      req.onsuccess = function () { resolve(record); };
      req.onerror = function () { reject(req.error || new Error('Datei konnte nicht gespeichert werden')); };
    });
    return record;
  }

  async function getFile(id) {
    if (!id) return null;
    return withStore('readonly', function (store, resolve, reject) {
      var req = store.get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error || new Error('Datei konnte nicht gelesen werden')); };
    });
  }

  async function deleteFile(id) {
    if (!id) return;
    await withStore('readwrite', function (store, resolve, reject) {
      var req = store.delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error || new Error('Datei konnte nicht geloescht werden')); };
    });
  }

  async function listFilesByKind(kind) {
    return withStore('readonly', function (store, resolve, reject) {
      var index = store.index('kind');
      var req = index.getAll(String(kind || ''));
      req.onsuccess = function () {
        var rows = Array.isArray(req.result) ? req.result.slice() : [];
        rows.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
        resolve(rows);
      };
      req.onerror = function () { reject(req.error || new Error('Dateien konnten nicht geladen werden')); };
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  global.NalpStorage = {
    PLAN_KEYS: PLAN_KEYS,
    PDF_REPO_PATHS: PDF_REPO_PATHS,
    IFC_REPO_PATHS: IFC_REPO_PATHS,
    GITHUB_OWNER: GITHUB_OWNER,
    GITHUB_REPO: GITHUB_REPO,
    GITHUB_BRANCH: GITHUB_BRANCH,
    getSettings: getSettings,
    setSettings: setSettings,
    updateSettings: updateSettings,
    uploadPdfToGitHub: uploadPdfToGitHub,
    deletePdfFromGitHub: deletePdfFromGitHub,
    uploadIfcToGitHub: uploadIfcToGitHub,
    deleteIfcFromGitHub: deleteIfcFromGitHub,
    saveFile: saveFile,
    getFile: getFile,
    deleteFile: deleteFile,
    listFilesByKind: listFilesByKind
  };
})(window);
