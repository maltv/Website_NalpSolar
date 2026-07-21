'use strict';
var CACHE = 'nalpsolar-v52';
var PRECACHE = [
  './index.html',
  './stahlbau.html',
  './passstueck.html',
  './assets/js/nalp-passstueck-daten.js',
  './assets/js/nalp-passstueck-abz.js',
  './stellen.html',
  './viewer3d.html',
  './assets/js/nalp-gate.js',
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
  './uploads/road.json',
  './uploads/bauablauf.json',
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
