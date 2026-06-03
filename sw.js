'use strict';
var CACHE = 'nalpsolar-v1';
var PRECACHE = [
  './viewer3d.html',
  './assets/js/three/three.min.js',
  './assets/js/three/OrbitControls.js',
  './assets/js/three/CSS2DRenderer.js',
  './uploads/terrain/terrain.json',
  './uploads/ifc/werkleitungen.meta.json',
  './uploads/ifc/werkleitungen.v.bin',
  './uploads/ifc/werkleitungen.f.bin',
  './uploads/ifc/erdung.meta.json',
  './uploads/ifc/erdung.v.bin',
  './uploads/ifc/erdung.f.bin'
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
  // Network first for WMS (satellite/terrain images), cache first for assets
  var url = e.request.url;
  var isExternal = url.includes('geo.admin.ch') || url.includes('api3.geo.admin.ch');

  if (isExternal) {
    e.respondWith(
      fetch(e.request).catch(function() { return caches.match(e.request); })
    );
    return;
  }

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
