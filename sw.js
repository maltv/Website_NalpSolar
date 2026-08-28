'use strict';
var CACHE = 'nalpsolar-v158';
var PRECACHE = [
  './index.html',
  './protokoll.html',
  './assets/js/nalp-protokoll.js',
  './assets/js/nalp-scan-parse.js',
  './sicherheit.html',
  './lieferscheine.html',
  './vormontage.html',
  // './gewinde.html',   abgeschaltet 28.08.2026 (Auftrag Victor)
  // './pfahlkopf.html',   abgeschaltet 28.08.2026 (Auftrag Victor)
  './einzelfundamente.html',
  './uploads/einzelfundamente.json',
  './assets/js/leaflet/leaflet.js',
  './assets/js/leaflet/leaflet.css',
  './uploads/pfaehle.json',
  './uploads/inventar.json',
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
  './uploads/maengel.json',
  './baupiste-chaos.html',
  './passstuecke-suchen.html',
  './assets/data/bpc.enc',
  './assets/js/nalp-terrain.js',
  './passstueck.html',
  './assets/js/nalp-passstueck-daten.js',
  // Laufende Normteil-Inventur im Tal - muss offline laufen
  './assets/js/nalp-lager.js',
  './uploads/material.json',
  './uploads/push.json',
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
  // Werkleitungen PZ1+PZ2+PZ3 in EINEM Layer (tools/build_leitungen.py);
  // loest werkleitungen.* + leitungen26.* ab (Victor 12.08.2026)
  './uploads/kabelblock.json',
  './uploads/ifc/leitungen.meta.json',
  './uploads/ifc/leitungen.v.bin',
  './uploads/ifc/leitungen.f.bin',
  './uploads/ifc/leitungen.e.bin',
  './uploads/ifc/erdung.meta.json',
  './uploads/ifc/erdung.v.bin',
  './uploads/ifc/erdung.f.bin',
  './uploads/tables/modultische.json',
  './uploads/tables/modultische_all.json',
  './uploads/tables/baustand.json',
  './uploads/tables/bohrstand.json',
  './uploads/tables/typen.json',
  './assets/js/leaflet/leaflet.js',
  './assets/js/leaflet/leaflet.css',
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
  './manifest-game.json',
  // Betonspurfertiger (14.08.2026): Seite offline halten, die PDFs bewusst NICHT
  // vorladen (1.4 MB) - die holt man sich im Tal ueber WLAN
  './betonspur.html',
  // 3D-Modell (18.08.2026): Seite offline halten, die STL (131 KB) laedt sie selbst nach
  './betonspur-3d.html',
  // Skizzenblock (17.08.2026): Zeichnen muss auch ohne Empfang gehen; der Stand
  // liegt im localStorage, Speichern auf dem Server braucht dann Netz.
  // './skizze.html',   abgeschaltet 28.08.2026 (Auftrag Victor)
  // Pizza-Truck 21.08.2026: Speisekarte auch am Berg ohne Empfang lesbar
  // (zum Abschicken braucht es dann trotzdem Netz). Nach dem Termin raus.
  './pizza.html',
  // Stoerungsjournal (Admin): Zahlen auch ohne Empfang lesbar; das Zuordnen
  // (Verantwortlicher/Nachtrag) braucht dann trotzdem Netz.
  './stoerungen.html',
  './uploads/stoerungen/stoerungen.json',
  // Team Verschrauben (18.08.2026): muss am Berg ohne Empfang laufen -
  // Abhaken und Mangelmeldung wandern dann in die Warteschlange.
  './verschrauben.html',
  './uploads/pfaehle.json',
  './uploads/tables/bereiche.json',
  // Einkauf (26.08.2026): Bedarf melden muss am Berg ohne Empfang gehen -
  // die Meldung samt Foto wartet dann in der IndexedDB-Warteschlange.
  './einkauf.html'
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


/* ─────────── Meldung aufs Handy (Web Push) ───────────
   Der Push selbst traegt keinen Text - er weckt nur den Service Worker.
   Was gemeldet wird, steht in der Datenbank unter erfassung/nt_warnung und
   wird von Tools\Normteile_Wache.py geschrieben. So entsteht der Meldetext
   an genau einer Stelle. */
var NALP_DB = 'https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app';

self.addEventListener('push', function(e) {
  e.waitUntil(
    fetch(NALP_DB + '/erfassung/nt_warnung.json', { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(w) {
        var titel = (w && w.titel) || 'NalpSolar';
        var text = (w && w.text) || 'Neue Meldung von der Baustelle.';
        return self.registration.showNotification(titel, {
          body: text,
          icon: './assets/img/strabag-logo.png',
          tag: (w && w.thema) || 'nalp',
          renotify: true,
          data: { url: (w && w.url) || './vormontage.html#lager' }
        });
      })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var ziel = (e.notification.data && e.notification.data.url) || './vormontage.html#lager';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(li) {
    for (var i = 0; i < li.length; i++) {
      if (li[i].url.indexOf('vormontage') > -1 && 'focus' in li[i]) return li[i].focus();
    }
    return clients.openWindow(ziel);
  }));
});
