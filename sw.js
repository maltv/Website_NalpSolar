'use strict';
var CACHE = 'nalpsolar-v91';
var PRECACHE = [
  './index.html',
  './sicherheit.html',
  './logistik.html',
  './lieferscheine.html',
  './vormontage.html',
  './gewinde.html',
  './pfahlkopf.html',
  './uploads/pfaehle.json',
  './uploads/perimeter_geo.json',
  './assets/img/perimeter.jpg',
  // Offline-Texterkennung fuer die Etiketten (laeuft ohne Internet im Tal)
  './assets/js/tesseract/tesseract.min.js',
  './assets/js/tesseract/worker.min.js',
  './assets/js/tesseract/tesseract-core-simd-lstm.wasm.js',
  './assets/js/tesseract/tesseract-core-lstm.wasm.js',
  './assets/js/tesseract/eng.traineddata.gz',
  './assets/img/hero.jpg',
  './assets/img/strabag-logo.png',
  './stahlbau.html',
  './baupiste-chaos.html',
  './passstuecke-suchen.html',
  './assets/data/bpc.enc',
  './assets/js/nalp-terrain.js',
  './passstueck.html',
  './assets/js/nalp-passstueck-daten.js',
  './assets/js/nalp-passstueck-abz.js',
  './stellen.html',
  './erfassungen.html',
  './viewer3d.html',
  './assets/js/nalp-gate.js',
  './assets/js/nalp-auth.js',
  './assets/js/nalp-stahlteile.js',
  './assets/js/nalp-status.js',
  './uploads/tables/modultische_status.json',
  './assets/js/three/three.min.js',
  './assets/js/three/OrbitControls.js',
  './assets/js/three/CSS2DRenderer.js',
  './uploads/terrain/terrain.json',
  './uploads/ifc/werkleitungen.meta.json',
  './uploads/ifc/werkleitungen.v.bin',
  './uploads/ifc/werkleitungen.f.bin',
  './uploads/ifc/erdung.meta.json',
  './uploads/ifc/erdung.v.bin',
  './uploads/ifc/erdung.f.bin',
  './uploads/ifc/leitungen26.meta.json',
  './uploads/ifc/leitungen26.v.bin',
  './uploads/ifc/leitungen26.f.bin',
  './uploads/ifc/leitungen26.c.bin',
  './uploads/tables/modultische.json',
  './uploads/tables/modultische_all.json',
  './uploads/tables/baustand.json',
  './uploads/tables/bohrstand.json',
  './uploads/tables/typen.json',
  './uploads/ortho/index.json',
  './uploads/ortho/vormontage_gebiete.jpg',
  './uploads/pk/A.meta.json',
  './uploads/pk/A_lod.v.bin',
  './uploads/pk/A_lod.f.bin',
  './uploads/pk/B.meta.json',
  './uploads/pk/B_lod.v.bin',
  './uploads/pk/B_lod.f.bin',
  './uploads/pk/D.meta.json',
  './uploads/pk/D_lod.v.bin',
  './uploads/pk/D_lod.f.bin',
  './uploads/pk/E.meta.json',
  './uploads/pk/E_lod.v.bin',
  './uploads/pk/E_lod.f.bin',
  './pk-modell.html',
  './uploads/road.json',
  './uploads/bauablauf.json',
  './bauprogramm.html',
  './uploads/bauprogramm_gantt.json',
  './game.html',
  './manifest-game.json'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return Promise.allSettled(PRECACHE.map(function(url) {
        return c.add(url).catch(function(){});
      }));
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;   // POSTs (z.B. Firebase-Scores) nie cachen
  var url = e.request.url;
  var isExternal = url.includes('geo.admin.ch') || url.includes('api3.geo.admin.ch');

  // External map tiles/images: network first, fall back to cache (offline)
  if (isExternal) {
    e.respondWith(
      fetch(e.request).catch(function() { return caches.match(e.request); })
    );
    return;
  }

  // App pages + data (HTML/JSON): network first so deploys show immediately,
  // fall back to cache when offline.
  var isFresh = e.request.mode === 'navigate'
    || url.endsWith('.html') || url.endsWith('.json')
    || url.indexOf('nalp-passstueck-') !== -1;   // SOLL-Daten/Konstanten: immer network first
  if (isFresh) {
    e.respondWith(
      fetch(e.request).then(function(resp) {
        if (resp.ok) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        }
        return resp;
      }).catch(function() { return caches.match(e.request); })
    );
    return;
  }

  // Static heavy assets (js/wasm/bins): cache first, fetch + store on miss
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(resp) {
        if (resp.ok) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        }
        return resp;
      });
    })
  );
});
