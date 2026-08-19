/* ═══════════════════════════════════════════════════════════════════
   Pfahlüberstand über Urgelände - Karte, Arbeitsliste und Erfassung
   ═══════════════════════════════════════════════════════════════════
   Zeigt, welche Pfähle mehr als die zulässigen 15 cm aus dem Urgelände
   ragen, und lässt die Gruppe im Feld abhaken, was eingedeckt ist -
   mit Foto als Nachweis. Daten aus uploads/pfahlueberstand.json,
   erzeugt von Tools\Pfahlueberstand_Bauen.py.

   Eingehängt im Baustellen-Portal über pfahlueberstand.html. Liegt als
   eigener Baustein hier, damit die Karte auch woanders eingehängt werden
   kann: NalpUeberstand.start(wurzelElement).

   OFFLINE: Auf der Baustelle gibt es streckenweise kein Netz. Jede Meldung
   geht zuerst in eine lokale Warteschlange und erst danach in die RTDB.
   Anders als die übrigen Seiten liegt die Warteschlange in IndexedDB und
   nicht in localStorage - dort passen nur ~5 MB, und ein einziges Foto
   belegt als base64 schon ein paar hundert Kilobyte. Ohne IndexedDB
   (privater Modus alter Browser) fällt der Baustein auf localStorage
   zurück und schickt die Meldung dann ohne Foto weg, statt sie zu
   verlieren.

   Kartenmuster (Canvas + SWISSIMAGE-Kacheln, Antippen statt GPS) wie in
   pfahlkopf.html - GPS ist für die Wahl des Einzelpfahls zu ungenau.
   ═══════════════════════════════════════════════════════════════════ */
window.NalpUeberstand = (function () {
  'use strict';

  var RTDB = 'https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app/erfassung';
  var PFAD = 'ueberstand';          // je Pfahl ein Satz, Schlüssel = Pfahl-ID
  var PFOTOS = 'ueberstand_fotos';  // Fotos getrennt, damit die Liste leicht bleibt
  var LS_VON = 'nalp_ueb_von';
  var LS_PEND = 'nalp_ueb_pend';    // nur Notnagel ohne IndexedDB
  var IDB_NAME = 'nalp_ueberstand_v1', IDB_STORE = 'warteschlange';

  var CSS = [
    '.ueb-kopf{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px}',
    '.ueb-kopf input{flex:1 1 150px;min-width:0;font:inherit;font-size:14px;padding:7px 10px;',
    '  border:1px solid #e3e5e8;border-radius:8px;background:#fff;color:#1a1a1a}',
    '.ueb-netz{font-size:11.5px;font-weight:700;color:#1e9e5a;background:#eaf6ef;',
    '  border:1px solid #bfe3cd;border-radius:20px;padding:5px 11px;white-space:nowrap}',
    '.ueb-netz.off{color:#a33;background:#fff3f3;border-color:#f2c9c9}',
    '.ueb-zahlen{display:flex;gap:8px;margin:0 0 12px;flex-wrap:wrap}',
    '.ueb-kachel{flex:1 1 90px;background:#f6f7f9;border:1px solid #e3e5e8;border-radius:9px;padding:7px 9px}',
    '.ueb-kachel b{display:block;font-size:19px;line-height:1.1}',
    '.ueb-kachel span{font-size:11px;color:#63676d}',
    '.ueb-kachel.warn b{color:#D72622}',
    '.ueb-kachel.gut b{color:#1e9e5a}',
    '.ueb-box{position:relative;background:#000;border-radius:12px;overflow:hidden;border:1px solid #e3e5e8}',
    '.ueb-box canvas{display:block;width:100%;height:62vh;min-height:340px;touch-action:none}',
    '.ueb-info{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.62);color:#fff;',
    '  font-size:11px;padding:3px 8px;border-radius:20px;pointer-events:none}',
    '.ueb-werkzeug{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}',
    '.ueb-sw{background:#fff;border:1px solid #e3e5e8;border-radius:20px;padding:6px 12px;',
    '  font-size:12.5px;color:#63676d;cursor:pointer;font-family:inherit}',
    '.ueb-sw.on{background:#1a1a1a;border-color:#1a1a1a;color:#fff;font-weight:700}',
    '.ueb-legende{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:#63676d;',
    '  margin:2px 0 10px;align-items:center}',
    '.ueb-legende i{width:11px;height:11px;border-radius:50%;display:inline-block;',
    '  vertical-align:-1px;margin-right:4px}',
    '.ueb-detail{background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:12px 14px;margin:10px 0}',
    '.ueb-detail h3{margin:0 0 8px;font-size:15px}',
    '.ueb-zeile{display:flex;justify-content:space-between;gap:12px;padding:4px 0;',
    '  border-bottom:1px dashed #e3e5e8;font-size:13px}',
    '.ueb-zeile:last-child{border-bottom:0}',
    '.ueb-zeile span:first-child{color:#63676d}',
    '.ueb-zeile span:last-child{font-weight:700;text-align:right}',
    '.ueb-tat{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}',
    '.ueb-knopf{flex:1 1 100%;font:inherit;font-size:15px;font-weight:700;padding:13px 16px;',
    '  border:0;border-radius:9px;background:#1e9e5a;color:#fff;cursor:pointer}',
    '.ueb-knopf:disabled{opacity:.5}',
    '.ueb-knopf.grau{background:#fff;color:#63676d;border:1px solid #e3e5e8;',
    '  font-size:13px;font-weight:400;padding:9px 14px;flex:1 1 auto}',
    '.ueb-fertig{background:#eaf6ef;border:1px solid #bfe3cd;border-radius:9px;',
    '  padding:9px 11px;font-size:12.5px;color:#14663a;margin-top:10px}',
    '.ueb-fertig img{display:block;margin-top:8px;max-width:100%;border-radius:7px}',
    '.ueb-hinweis{background:#fff8e6;border:1px solid #f0dca8;border-radius:9px;padding:8px 10px;',
    '  font-size:12px;color:#6b5310;margin-top:9px}',
    '.ueb-gruppe{background:#fff;border:1px solid #e3e5e8;border-radius:12px;margin:10px 0;overflow:hidden}',
    '.ueb-gkopf{display:flex;justify-content:space-between;align-items:center;gap:10px;',
    '  padding:11px 14px;cursor:pointer;background:#fff;border:0;width:100%;text-align:left;',
    '  font-size:14px;font-weight:700;font-family:inherit}',
    '.ueb-gkopf:hover{background:#f6f7f9}',
    '.ueb-gkopf small{font-weight:400;color:#63676d;font-size:12px}',
    '.ueb-gliste{display:none;border-top:1px solid #e3e5e8}',
    '.ueb-gliste.auf{display:block}',
    '.ueb-gp{display:flex;justify-content:space-between;align-items:center;gap:10px;',
    '  padding:8px 14px;border-bottom:1px solid #f1f2f4;font-size:13px;cursor:pointer}',
    '.ueb-gp:last-child{border-bottom:0}',
    '.ueb-gp:hover{background:#f6f7f9}',
    '.ueb-gp.fertig{background:#f7fbf8;color:#63676d}',
    '.ueb-gp b{font-variant-numeric:tabular-nums}',
    '.ueb-marke{font-size:10.5px;padding:1px 6px;border-radius:10px;border:1px solid #e3e5e8;',
    '  color:#63676d;white-space:nowrap}',
    '.ueb-marke.grob{background:#fff3f3;border-color:#f2c9c9;color:#a33}',
    '.ueb-marke.mittel{background:#fffaed;border-color:#ecd9a4;color:#7a5f10}',
    '.ueb-quellen{font-size:11.5px;color:#63676d;line-height:1.55;margin-top:18px;',
    '  border-top:1px solid #e3e5e8;padding-top:12px}',
    '.ueb-quellen b{color:#1a1a1a}',
    '.ueb-laden{padding:40px 0;text-align:center;color:#63676d}',
    '.ueb-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99;',
    '  background:#1a1a1a;color:#fff;font-size:13px;padding:10px 16px;border-radius:9px;',
    '  opacity:0;pointer-events:none;transition:opacity .2s;max-width:90vw;text-align:center}',
    '.ueb-toast.on{opacity:1}',
    '.ueb-toast.err{background:#D72622}'
  ].join('\n');

  var MARKUP = [
    '<div class="ueb-laden" id="uebLaden">Daten werden geladen …</div>',
    '<div id="uebInhalt" style="display:none">',
    '  <div class="ueb-kopf">',
    '    <input id="uebVon" type="text" placeholder="Dein Name – für die Meldung" autocomplete="name">',
    '    <span class="ueb-netz" id="uebNetz">online</span>',
    '  </div>',
    '  <div class="ueb-zahlen" id="uebZahlen"></div>',
    '  <div class="ueb-box"><canvas id="uebKarte"></canvas>',
    '    <div class="ueb-info" id="uebInfo"></div></div>',
    '  <div class="ueb-werkzeug">',
    '    <button class="ueb-sw on" id="uebFOffen">Offen</button>',
    '    <button class="ueb-sw" id="uebFFertig">Erledigt</button>',
    '    <button class="ueb-sw" id="uebFHoch">Alle zu hoch</button>',
    '    <button class="ueb-sw" id="uebFAlle">Alle Pfähle</button>',
    '    <button class="ueb-sw on" id="uebSwSat">Satellit</button>',
    '    <button class="ueb-sw" id="uebSwIds">Nummern</button>',
    '    <button class="ueb-sw" id="uebGanz">Ganze Baustelle</button>',
    '  </div>',
    '  <div class="ueb-legende">',
    '    <span><i style="background:#8c1512"></i>über 50 cm</span>',
    '    <span><i style="background:#D72622"></i>30–50 cm</span>',
    '    <span><i style="background:#f08c00"></i>15–30 cm</span>',
    '    <span><i style="background:#1e9e5a"></i>erledigt / im Rahmen</span>',
    '    <span><i style="background:#fff;border:2px solid #D72622"></i>hohl = Geländehöhe grob,',
    '      vor dem Eindecken nachmessen</span>',
    '  </div>',
    '  <div class="ueb-detail" id="uebDetail"><h3>Pfahl antippen</h3></div>',
    '  <h3 style="font-size:15px;margin:22px 0 4px">Arbeitsliste nach Bereich</h3>',
    '  <div style="font-size:12px;color:#63676d;margin-bottom:8px">Nur Pfähle über der',
    '    Schwelle. Antippen springt auf die Karte.</div>',
    '  <div id="uebListe"></div>',
    '  <div class="ueb-quellen" id="uebQuellen"></div>',
    '</div>',
    '<input type="file" id="uebFoto" accept="image/*" capture="environment" style="display:none">',
    '<div class="ueb-toast" id="uebToast"></div>'
  ].join('\n');

  var DATEN = null, pfaehle = [], sel = null, filter = 'offen';
  var ERL = {};                       // Pfahl-ID -> Meldesatz
  var zeigeSat = true, zeigeIds = false;
  var ORIGIN = null, view = { cx: 0, cy: 0, mpp: 1.2 };
  var cv, ctx, dpr = 1, gestartet = false, wurzel = null, VON = '';
  function $(i) { return document.getElementById(i); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(t, err) {
    var e = $('uebToast'); if (!e) return;
    e.textContent = t; e.className = 'ueb-toast on' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { e.className = 'ueb-toast'; }, 2800);
  }
  function netzAn() { return navigator.onLine !== false; }

  /* ─────────── Warteschlange ───────────
     IndexedDB, weil Fotos als base64 den localStorage sprengen. Ohne
     IndexedDB bleibt localStorage als Notnagel - dann ohne Foto. */
  var Q = (function () {
    var kannIDB = !!window.indexedDB, dbP = null;
    function db() {
      if (dbP) return dbP;
      dbP = new Promise(function (ok, fehl) {
        var a = window.indexedDB.open(IDB_NAME, 1);
        a.onupgradeneeded = function () {
          if (!a.result.objectStoreNames.contains(IDB_STORE)) {
            a.result.createObjectStore(IDB_STORE, { keyPath: 'k', autoIncrement: true });
          }
        };
        a.onsuccess = function () { ok(a.result); };
        a.onerror = function () { fehl(a.error); };
      }).catch(function () { kannIDB = false; return null; });
      return dbP;
    }
    function tx(modus, arbeit) {
      return db().then(function (d) {
        if (!d) return null;
        return new Promise(function (ok, fehl) {
          var t = d.transaction(IDB_STORE, modus), s = t.objectStore(IDB_STORE);
          var r = arbeit(s);
          t.oncomplete = function () { ok(r && r.result !== undefined ? r.result : null); };
          t.onerror = function () { fehl(t.error); };
        });
      });
    }
    function lsLesen() {
      try { return JSON.parse(localStorage.getItem(LS_PEND) || '[]'); } catch (e) { return []; }
    }
    function lsSchreiben(a) {
      try { localStorage.setItem(LS_PEND, JSON.stringify(a.slice(-400))); } catch (e) {}
    }
    return {
      add: function (job) {
        if (kannIDB) {
          return tx('readwrite', function (s) { return s.add(job); })
            .catch(function () { kannIDB = false; return Q.add(job); });
        }
        var j = { k: Date.now() + Math.round(Math.random() * 1e6), id: job.id, rec: job.rec };
        var a = lsLesen(); a.push(j); lsSchreiben(a);          // Foto faellt hier weg
        return Promise.resolve(j.k);
      },
      alle: function () {
        if (kannIDB) {
          return tx('readonly', function (s) { return s.getAll(); })
            .then(function (r) { return r || []; })
            .catch(function () { return lsLesen(); });
        }
        return Promise.resolve(lsLesen());
      },
      weg: function (k) {
        if (kannIDB) {
          return tx('readwrite', function (s) { return s.delete(k); }).catch(function () {});
        }
        lsSchreiben(lsLesen().filter(function (j) { return j.k !== k; }));
        return Promise.resolve();
      },
      mitFoto: function () { return kannIDB; }
    };
  })();

  function netzMalen() {
    Q.alle().then(function (a) {
      var e = $('uebNetz'); if (!e) return;
      e.className = 'ueb-netz' + (netzAn() ? '' : ' off');
      e.textContent = (netzAn() ? 'online' : 'offline') + (a.length ? ' · ' + a.length + ' offen' : '');
    });
  }

  /* Meldungen der Reihe nach wegschicken. Erst das Foto (eigener Knoten),
     dann der Satz mit dem Verweis darauf - so zeigt kein Satz auf ein Foto,
     das nie ankam. Was nicht durchgeht, bleibt in der Warteschlange. */
  var sendeLaeuft = false;
  function pendSenden() {
    if (!netzAn() || sendeLaeuft) return Promise.resolve();
    sendeLaeuft = true;
    return Q.alle().then(function (jobs) {
      return jobs.reduce(function (kette, j) {
        return kette.then(function () {
          if (j.rec === null) {                     // Meldung zuruecknehmen
            return fetch(RTDB + '/' + PFAD + '/' + encodeURIComponent(j.id) + '.json',
                         { method: 'DELETE' })
              .then(function (r) { if (r.ok) return Q.weg(j.k); });
          }
          var rec = {};
          for (var s in j.rec) rec[s] = j.rec[s];
          var vor = j.foto
            ? fetch(RTDB + '/' + PFOTOS + '.json', { method: 'POST',
                body: JSON.stringify({ pfahl: j.id, von: rec.von, ts: rec.ts, data: j.foto }) })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (a) {
                  if (!a || !a.name) throw 0;
                  rec.fotos = {}; rec.fotos[a.name] = true;
                })
            : Promise.resolve();
          return vor.then(function () {
            return fetch(RTDB + '/' + PFAD + '/' + encodeURIComponent(j.id) + '.json',
                         { method: 'PUT', body: JSON.stringify(rec) });
          }).then(function (r) {
            if (r && r.ok) { ERL[j.id] = rec; return Q.weg(j.k); }
          }).catch(function () {});
        });
      }, Promise.resolve());
    }).then(function () {
      sendeLaeuft = false;
      netzMalen();
      return Q.alle().then(function (a) {
        if (!a.length && jobsVorher) { toast('Gespeicherte Meldungen sind raus'); }
        jobsVorher = a.length > 0;
      });
    }).catch(function () { sendeLaeuft = false; });
  }
  var jobsVorher = false;

  /* ─────────── Foto ─────────── */
  /* 1400 px wie in ls.html - die Stelle muss auf dem Bild erkennbar bleiben,
     aber ein Handyfoto in voller Groesse waere als base64 mehrere Megabyte. */
  function bildLesen(datei, fertig) {
    var img = new Image();
    img.onload = function () {
      var m = 1400, w = img.width, h = img.height;
      if (w > m || h > m) {
        if (w > h) { h = Math.round(h * m / w); w = m; } else { w = Math.round(w * m / h); h = m; }
      }
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      var d = c.toDataURL('image/jpeg', 0.78);
      if (d.length > 1300000) d = c.toDataURL('image/jpeg', 0.6);
      URL.revokeObjectURL(img.src);
      fertig(d);
    };
    img.onerror = function () { URL.revokeObjectURL(img.src); fertig(null); };
    img.src = URL.createObjectURL(datei);
  }

  /* ─────────── Melden ─────────── */
  /* Den Namen dort lesen, wo er gebraucht wird - nicht auf einen Seiteneffekt
     einer vorher gelaufenen Pruefung verlassen, sonst geht eine Meldung ohne
     Melder raus, sobald jemand den Ablauf anders aufruft. */
  function nameLesen() {
    VON = ($('uebVon') && $('uebVon').value || '').trim();
    if (VON) { try { localStorage.setItem(LS_VON, VON); } catch (e) {} }
    return VON;
  }
  function namePruefen() {
    if (!nameLesen()) { toast('Bitte oben deinen Namen eintragen', true); return false; }
    return true;
  }
  function melden(pfahl, foto) {
    var rec = { erledigt: 1, ts: Date.now(), von: nameLesen(), foto: foto ? 1 : 0 };
    ERL[pfahl.id] = rec;                                  // sofort sichtbar
    if (foto) rec._vorschau = foto;
    kopfMalen(); listeMalen(); malen(); detailMalen();
    Q.add({ id: pfahl.id, rec: { erledigt: 1, ts: rec.ts, von: rec.von, foto: rec.foto },
            foto: foto || null })
      .then(function () {
        jobsVorher = true; netzMalen();
        toast(netzAn() ? 'Erledigt gemeldet' : 'Gespeichert – geht raus, sobald Netz da ist');
        return pendSenden();
      });
  }
  function zuruecknehmen(pfahl) {
    delete ERL[pfahl.id];
    kopfMalen(); listeMalen(); malen(); detailMalen();
    Q.add({ id: pfahl.id, rec: null, foto: null }).then(function () {
      jobsVorher = true; netzMalen(); toast('Wieder offen'); return pendSenden();
    });
  }
  function fotoAufnehmen(pfahl) {
    if (!namePruefen()) return;
    var f = $('uebFoto');
    f.value = '';
    f.onchange = function () {
      var d = f.files && f.files[0];
      if (!d) return;
      if (!Q.mitFoto()) {
        toast('Dieser Browser kann offline keine Fotos halten – Meldung geht ohne Foto', true);
        melden(pfahl, null); return;
      }
      toast('Foto wird verkleinert …');
      bildLesen(d, function (data) {
        if (!data) { toast('Foto konnte nicht gelesen werden', true); return; }
        melden(pfahl, data);
      });
    };
    f.click();
  }

  /* ─────────── Farbe und Grösse nach Überstand ─────────── */
  function stufe(u) {
    if (u > 0.50) return { f: '#8c1512', r: 5.5, t: 'über 50 cm' };
    if (u > 0.30) return { f: '#D72622', r: 4.6, t: '30–50 cm' };
    if (u > 0.15) return { f: '#f08c00', r: 3.8, t: '15–30 cm' };
    return { f: '#1e9e5a', r: 2.6, t: 'im Rahmen' };
  }
  function cm(u) { return (u >= 0 ? '+' : '−') + Math.abs(Math.round(u * 100)) + ' cm'; }
  function fertig(p) { return !!ERL[p.id]; }
  function datum(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    function zz(n) { return (n < 10 ? '0' : '') + n; }
    return zz(d.getDate()) + '.' + zz(d.getMonth() + 1) + '.' + d.getFullYear()
         + ' ' + zz(d.getHours()) + ':' + zz(d.getMinutes());
  }

  /* ─────────── Projektion ─────────── */
  function zuMeter(lat, lon) {
    return { x: (lon - ORIGIN.lon) * 111320 * Math.cos(ORIGIN.lat * Math.PI / 180),
             y: (lat - ORIGIN.lat) * 111320 };
  }
  function zuGrad(x, y) {
    return { lat: ORIGIN.lat + y / 111320,
             lon: ORIGIN.lon + x / (111320 * Math.cos(ORIGIN.lat * Math.PI / 180)) };
  }
  function s2p(p) {
    var r = cv.getBoundingClientRect();
    return { x: r.width / 2 + (p.x - view.cx) / view.mpp,
             y: r.height / 2 - (p.y - view.cy) / view.mpp };
  }
  function p2s(px, py) {
    var r = cv.getBoundingClientRect();
    return { x: view.cx + (px - r.width / 2) * view.mpp,
             y: view.cy - (py - r.height / 2) * view.mpp };
  }

  /* ─────────── Satellitenbild (SWISSIMAGE, wie karte.html) ─────────── */
  var TILE = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/';
  var kacheln = {}, kachelTimer = null;
  function lon2tx(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function lat2ty(lat, z) {
    var r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
  }
  function tx2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function ty2lat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
  function kachel(z, x, y) {
    var k = z + '/' + x + '/' + y;
    if (kacheln[k]) return kacheln[k];
    var img = new Image();
    kacheln[k] = img;
    img.onload = function () { img._ok = 1; neuZeichnenBald(); };
    img.onerror = function () { img._ok = 0; };
    img.src = TILE + z + '/' + x + '/' + y + '.jpeg';
    return img;
  }
  function neuZeichnenBald() {
    if (kachelTimer) return;
    kachelTimer = setTimeout(function () { kachelTimer = null; malen(); }, 80);
  }
  function satEbene(r, z) {
    var nw = zuGrad(view.cx - r.width / 2 * view.mpp, view.cy + r.height / 2 * view.mpp);
    var se = zuGrad(view.cx + r.width / 2 * view.mpp, view.cy - r.height / 2 * view.mpp);
    var x0 = Math.floor(lon2tx(nw.lon, z)), x1 = Math.floor(lon2tx(se.lon, z));
    var y0 = Math.floor(lat2ty(nw.lat, z)), y1 = Math.floor(lat2ty(se.lat, z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 200) return;     // Notbremse gegen Kachelflut
    for (var x = x0; x <= x1; x++) {
      for (var y = y0; y <= y1; y++) {
        var img = kachel(z, x, y);
        if (!img._ok) continue;
        var a = s2p(zuMeter(ty2lat(y, z), tx2lon(x, z)));
        var b = s2p(zuMeter(ty2lat(y + 1, z), tx2lon(x + 1, z)));
        var px = Math.floor(a.x), py = Math.floor(a.y);
        ctx.drawImage(img, px, py, Math.ceil(b.x - px) + 1, Math.ceil(b.y - py) + 1);
      }
    }
  }
  function satMalen(r) {
    if (!zeigeSat || !ORIGIN) return;
    /* SWISSIMAGE liefert bis z=20, ab z=21 kommt HTTP 400. */
    var breiteProKachel = 40075016.686 * Math.cos(ORIGIN.lat * Math.PI / 180);
    var z = Math.round(Math.log(breiteProKachel / (256 * view.mpp)) / Math.LN2);
    z = Math.max(12, Math.min(20, z));
    if (z > 13) satEbene(r, Math.max(12, z - 3));        // grobe Unterlage gegen weisse Löcher
    satEbene(r, z);
  }

  /* ─────────── Zeichnen ─────────── */
  function sichtbar(p) {
    if (filter === 'alle') return true;
    if (filter === 'fertig') return fertig(p);
    if (filter === 'hoch') return p.ampel === 'rot';
    return p.ampel === 'rot' && !fertig(p);             // 'offen'
  }
  function malen() {
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    if (!r.width) return;                                // Reiter/Seite noch verborgen
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, r.width, r.height);
    satMalen(r);

    var gezeichnet = 0;
    /* erledigte und grüne zuerst, damit die offenen roten oben liegen */
    var sortiert = pfaehle.slice().sort(function (a, b) {
      var fa = fertig(a) ? -1 : 0, fb = fertig(b) ? -1 : 0;
      return (fa - fb) || (a.ueb - b.ueb);
    });
    for (var i = 0; i < sortiert.length; i++) {
      var p = sortiert[i]; if (!sichtbar(p)) continue;
      var q = s2p(p);
      if (q.x < -20 || q.y < -20 || q.x > r.width + 20 || q.y > r.height + 20) continue;
      gezeichnet++;
      var ist = fertig(p);
      var st = stufe(p.ueb);
      var farbe = ist ? '#1e9e5a' : st.f;
      var rad = Math.max(2.2, Math.min(st.r * 2.4, st.r / Math.max(view.mpp, 0.06) * 0.55));
      ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, 6.2832);
      if (p.guete === 'hoch' || ist) {
        ctx.fillStyle = farbe; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke();
      } else {
        /* hohl = Geländehöhe nur grob bekannt, im Feld nachmessen */
        ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
        ctx.lineWidth = Math.max(1.6, rad * 0.45); ctx.strokeStyle = farbe; ctx.stroke();
      }
      if (ist && rad >= 5) {                              // Haken erst, wenn er lesbar ist
        ctx.beginPath();
        ctx.moveTo(q.x - rad * 0.45, q.y);
        ctx.lineTo(q.x - rad * 0.1, q.y + rad * 0.38);
        ctx.lineTo(q.x + rad * 0.5, q.y - rad * 0.4);
        ctx.lineWidth = Math.max(1.4, rad * 0.26);
        ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
      }
      if (zeigeIds && view.mpp < 0.9) {
        ctx.font = '700 10px Arial'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.strokeText(p.tisch, q.x, q.y - rad - 3);
        ctx.fillStyle = '#fff'; ctx.fillText(p.tisch, q.x, q.y - rad - 3);
      }
    }
    if (sel) {
      var q2 = s2p(sel);
      ctx.beginPath(); ctx.arc(q2.x, q2.y, 13, 0, 6.2832);
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#1565c0'; ctx.stroke();
      ctx.beginPath(); ctx.arc(q2.x, q2.y, 17, 0, 6.2832);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    }
    $('uebInfo').textContent = gezeichnet + ' Pfähle sichtbar · Ausschnitt ca. '
      + Math.round(r.width * view.mpp) + ' m';
  }

  /* ─────────── Bedienung ─────────── */
  function zoomen(f, zx, zy) {
    var r = cv.getBoundingClientRect();
    var mx = zx == null ? r.width / 2 : zx, my = zy == null ? r.height / 2 : zy;
    var vor = p2s(mx, my);
    view.mpp = Math.max(0.06, Math.min(12, view.mpp / f));
    var nach = p2s(mx, my);
    view.cx += vor.x - nach.x; view.cy += vor.y - nach.y;
    malen();
  }
  function springen(x, y, mpp) { view.cx = x; view.cy = y; if (mpp) view.mpp = mpp; malen(); }
  function ganzeBaustelle() {
    var r = cv.getBoundingClientRect();
    if (!r.width) return;
    var xs = pfaehle.map(function (p) { return p.x; });
    var ys = pfaehle.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
    view.mpp = Math.max((x1 - x0) / r.width, (y1 - y0) / r.height) * 1.12;
    malen();
  }
  var ptr = {}, tapStart = null, bewegt = 0;
  function kartenEvents() {
    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(ptr).length === 1) { tapStart = Date.now(); bewegt = 0; }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!ptr[e.pointerId]) return;
      var ids = Object.keys(ptr), r = cv.getBoundingClientRect();
      if (ids.length === 1) {
        var dx = e.clientX - ptr[e.pointerId].x, dy = e.clientY - ptr[e.pointerId].y;
        bewegt += Math.abs(dx) + Math.abs(dy);
        view.cx -= dx * view.mpp; view.cy += dy * view.mpp;
        ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
        malen();
      } else if (ids.length === 2) {
        var a = ptr[ids[0]], b = ptr[ids[1]];
        var altD = Math.hypot(a.x - b.x, a.y - b.y);
        ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
        a = ptr[ids[0]]; b = ptr[ids[1]];
        var neuD = Math.hypot(a.x - b.x, a.y - b.y);
        if (altD > 4 && neuD > 4) {
          bewegt += 20;
          zoomen(neuD / altD, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        }
      }
    });
    function hoch(e) {
      if (Object.keys(ptr).length === 1 && bewegt < 10 && Date.now() - tapStart < 500) {
        var r = cv.getBoundingClientRect();
        waehlenBeiPixel(e.clientX - r.left, e.clientY - r.top);
      }
      delete ptr[e.pointerId];
    }
    cv.addEventListener('pointerup', hoch);
    cv.addEventListener('pointercancel', function (e) { delete ptr[e.pointerId]; });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      zoomen(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    window.addEventListener('resize', malen);
  }
  function waehlenBeiPixel(px, py) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < pfaehle.length; i++) {
      var p = pfaehle[i]; if (!sichtbar(p)) continue;
      var q = s2p(p), d = Math.hypot(q.x - px, q.y - py);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best || bestD > 22) return;
    sel = best; malen(); detailMalen();
    if (navigator.vibrate) navigator.vibrate(20);
  }
  function filterSetzen(f) {
    filter = f;
    $('uebFOffen').classList.toggle('on', f === 'offen');
    $('uebFFertig').classList.toggle('on', f === 'fertig');
    $('uebFHoch').classList.toggle('on', f === 'hoch');
    $('uebFAlle').classList.toggle('on', f === 'alle');
    malen();
  }
  function schalter(was) {
    if (was === 'sat') { zeigeSat = !zeigeSat; $('uebSwSat').classList.toggle('on', zeigeSat); }
    if (was === 'ids') {
      zeigeIds = !zeigeIds; $('uebSwIds').classList.toggle('on', zeigeIds);
      if (zeigeIds && view.mpp >= 0.9) {
        $('uebInfo').textContent = 'Tisch-Nummern erscheinen beim Reinzoomen';
      }
    }
    malen();
  }

  /* ─────────── Detail zum gewählten Pfahl ─────────── */
  var QNAME = { mai: 'Drohne 14.05.2025 (vor Baubeginn)',
                sep: 'Drohne 18.09.2025 (Gelände dort unverändert)',
                alti: 'swissALTI3D 2 m (grob)' };
  function z(a, b) {
    return '<div class="ueb-zeile"><span>' + a + '</span><span>' + b + '</span></div>';
  }
  function detailMalen() {
    var p = sel; if (!p) return;
    var st = stufe(p.ueb), m = ERL[p.id];
    var h = '<h3>' + esc(p.tisch) + ' · ' + esc(p.stelle)
          + ' <span style="color:' + (m ? '#1e9e5a' : st.f) + '">' + cm(p.ueb) + '</span></h3>';
    h += z('Überstand über Urgelände', cm(p.ueb) + '  (' + st.t + ')');
    h += z('OK Pfahlrohr eingemessen', p.ist.toFixed(3) + ' m');
    h += z('Urgelände', p.gel.toFixed(3) + ' m');
    h += z('Geländequelle', (QNAME[p.quelle] || p.quelle)
         + (p.best ? ' · durch zweiten Flug bestätigt' : ''));
    if (p.mai != null && p.sep != null) {
      h += z('Mai / September / ALTI3D', p.mai.toFixed(2) + ' · ' + p.sep.toFixed(2)
           + ' · ' + (p.alti != null ? p.alti.toFixed(2) : '–'));
    }
    h += z('Hangneigung', (p.neig != null ? p.neig + ' %' : '–'));
    h += z('Bereich · Typ', esc(p.bereich) + ' · ' + esc(p.typ));

    if (m) {
      h += '<div class="ueb-fertig"><b>✓ Eingedeckt</b>'
         + (m.von ? ' von ' + esc(m.von) : '') + (m.ts ? ' · ' + datum(m.ts) : '')
         + (m.foto ? '' : '<br>ohne Foto gemeldet')
         + (m._vorschau ? '<img src="' + m._vorschau + '" alt="Foto">' : '')
         + '</div>'
         + '<div class="ueb-tat"><button class="ueb-knopf grau" id="uebZurueck">'
         + 'Doch noch offen</button></div>';
    } else if (p.ampel === 'rot') {
      h += '<div class="ueb-tat">'
         + '<button class="ueb-knopf" id="uebFertigF">📷 Eingedeckt – Foto machen</button>'
         + '<button class="ueb-knopf grau" id="uebFertigO">ohne Foto melden</button>'
         + '</div>';
    }
    if (p.guete !== 'hoch') {
      h += '<div class="ueb-hinweis"><b>Vor dem Eindecken nachmessen.</b> '
         + esc(p.warn || 'Geländehöhe nur grob bekannt.') + '</div>';
    }
    if (p.ueb > 1.0) {
      h += '<div class="ueb-hinweis"><b>Mehr als 1 m – das ist kein Eindecken mehr.</b> '
         + 'Hier steht eine Geländeanpassung oder eine planerische Klärung an.</div>';
    }
    $('uebDetail').innerHTML = h;
    if ($('uebFertigF')) $('uebFertigF').onclick = function () { fotoAufnehmen(p); };
    if ($('uebFertigO')) $('uebFertigO').onclick = function () {
      if (namePruefen()) melden(p, null);
    };
    if ($('uebZurueck')) $('uebZurueck').onclick = function () { zuruecknehmen(p); };
  }

  /* ─────────── Arbeitsliste nach Bereich ─────────── */
  function listeMalen() {
    var rot = pfaehle.filter(function (p) { return p.ampel === 'rot'; });
    var g = {};
    rot.forEach(function (p) { (g[p.bereich] = g[p.bereich] || []).push(p); });
    var namen = Object.keys(g).sort(function (a, b) {
      /* Bereiche mit offener Arbeit zuerst, darin die grössten Mengen */
      var oa = g[a].filter(function (p) { return !fertig(p); }).length;
      var ob = g[b].filter(function (p) { return !fertig(p); }).length;
      return (ob - oa) || (g[b].length - g[a].length);
    });
    var h = '';
    namen.forEach(function (n, i) {
      /* offene zuerst, erledigte ans Ende - die Gruppe arbeitet von oben ab */
      var v = g[n].slice().sort(function (a, b) {
        var fa = fertig(a) ? 1 : 0, fb = fertig(b) ? 1 : 0;
        return (fa - fb) || (b.ueb - a.ueb);
      });
      var offen = v.filter(function (p) { return !fertig(p); }).length;
      var tische = Object.keys(v.reduce(function (a, p) { a[p.tisch] = 1; return a; }, {})).length;
      h += '<div class="ueb-gruppe"><button class="ueb-gkopf" data-gruppe="' + i + '">'
         + '<span>' + esc(n === '?' ? 'ohne Bereichszuordnung' : n) + '<br>'
         + '<small>' + offen + ' von ' + v.length + ' offen · ' + tische + ' Tische</small></span>'
         + '<span style="color:#63676d;font-size:12px">▾</span></button>'
         + '<div class="ueb-gliste" id="uebGl' + i + '">';
      v.forEach(function (p) {
        var ist = fertig(p), st = stufe(p.ueb);
        h += '<div class="ueb-gp' + (ist ? ' fertig' : '') + '" data-pfahl="' + esc(p.id) + '">'
           + '<span>' + (ist ? '✓ ' : '') + esc(p.tisch) + ' · ' + esc(p.stelle)
           + (p.guete === 'hoch' ? '' : ' <span class="ueb-marke ' + p.guete + '">nachmessen</span>')
           + '</span><b style="color:' + (ist ? '#1e9e5a' : st.f) + '">' + cm(p.ueb) + '</b></div>';
      });
      h += '</div></div>';
    });
    var ziel = $('uebListe');
    ziel.innerHTML = h || '<div class="ueb-detail">Kein Pfahl über der Schwelle.</div>';
    /* Klicks gebündelt statt inline-onclick - der Baustein läuft in fremden Seiten,
       da darf er sich nicht auf globale Funktionsnamen verlassen. */
    ziel.onclick = function (e) {
      var k = e.target.closest ? e.target.closest('.ueb-gkopf,.ueb-gp') : null;
      if (!k) return;
      if (k.classList.contains('ueb-gkopf')) {
        $('uebGl' + k.getAttribute('data-gruppe')).classList.toggle('auf');
      } else {
        zuPfahl(k.getAttribute('data-pfahl'));
      }
    };
  }
  function zuPfahl(id) {
    var p = pfaehle.filter(function (q) { return q.id === id; })[0];
    if (!p) return;
    if (!sichtbar(p)) filterSetzen('hoch');
    sel = p; springen(p.x, p.y, Math.min(view.mpp, 0.25)); detailMalen();
    wurzel.querySelector('.ueb-box').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ─────────── Kopfzahlen und Quellen ─────────── */
  function kachelHtml(n, t, k) {
    return '<div class="ueb-kachel ' + k + '"><b>' + n + '</b><span>' + t + '</span></div>';
  }
  function kopfMalen() {
    var rot = pfaehle.filter(function (p) { return p.ampel === 'rot'; });
    var f = rot.filter(fertig).length;
    var nach = rot.filter(function (p) { return p.guete !== 'hoch' && !fertig(p); }).length;
    $('uebZahlen').innerHTML =
      kachelHtml(rot.length - f, 'noch einzudecken', 'warn')
      + kachelHtml(f, 'erledigt', 'gut')
      + kachelHtml(nach, 'davon nachmessen', '')
      + kachelHtml(rot.length, 'zu hoch insgesamt', '');
  }
  function quellenMalen() {
    var q = DATEN.quellen, s = DATEN.zusammenfassung;
    $('uebQuellen').innerHTML =
      'Stand ' + esc(DATEN.stand) + ' · Schwelle ' + Math.round(DATEN.schwelle * 100) + ' cm · '
      + s.bewertet + ' eingemessene Pfähle<br><br>'
      + '<b>Vorgabe</b><br>' + esc(q.vorgabe) + '<br><br>'
      + '<b>Pfahlhöhe</b><br>' + esc(q.ist) + '<br><br>'
      + '<b>Urgelände</b><br>1. ' + esc(q.mai) + '<br>2. ' + esc(q.sep) + '<br>3. ' + esc(q.alti)
      + '<br><br><b>Wie die Geländequelle gewählt wird</b><br>' + esc(DATEN.regel) + '<br><br>'
      + 'Verwendet: ' + s.mai + ' Pfähle aus dem Maiflug, ' + s.sep
      + ' aus dem Septemberflug, ' + s.alti + ' aus swissALTI3D.<br>'
      + 'Erzeugt von <code>Tools\\Pfahlueberstand_Bauen.py</code>, Stand ' + esc(DATEN.stand) + '.';
  }

  /* ─────────── Start ─────────── */
  function aufbauen() {
    cv = $('uebKarte'); ctx = cv.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    try { $('uebVon').value = localStorage.getItem(LS_VON) || ''; } catch (e) {}
    $('uebVon').onchange = nameLesen;
    $('uebFOffen').onclick = function () { filterSetzen('offen'); };
    $('uebFFertig').onclick = function () { filterSetzen('fertig'); };
    $('uebFHoch').onclick = function () { filterSetzen('hoch'); };
    $('uebFAlle').onclick = function () { filterSetzen('alle'); };
    $('uebSwSat').onclick = function () { schalter('sat'); };
    $('uebSwIds').onclick = function () { schalter('ids'); };
    $('uebGanz').onclick = ganzeBaustelle;
    window.addEventListener('online', function () { netzMalen(); pendSenden(); });
    window.addEventListener('offline', netzMalen);
    kartenEvents();
    ganzeBaustelle();
  }

  function start(el) {
    /* Mehrfachaufruf ist erlaubt: eingebettet in einer Reiterseite kommt start()
       bei jedem Wechsel, damit die Karte nach dem Einblenden ihre echte Breite
       bekommt. Dann wird nur der Ausschnitt angepasst, nicht neu geladen. */
    if (gestartet) { ganzeBaustelle(); return; }
    wurzel = el;
    if (!document.getElementById('uebStil')) {
      var st = document.createElement('style');
      st.id = 'uebStil'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    wurzel.innerHTML = MARKUP;
    fetch('uploads/pfahlueberstand.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        DATEN = j; pfaehle = j.pfaehle;
        var la = 0, lo = 0;
        pfaehle.forEach(function (p) { la += p.lat; lo += p.lon; });
        ORIGIN = { lat: la / pfaehle.length, lon: lo / pfaehle.length };
        pfaehle.forEach(function (p) { var m = zuMeter(p.lat, p.lon); p.x = m.x; p.y = m.y; });
        /* Meldungen dazu - ohne Netz bleibt es bei dem, was lokal in der
           Warteschlange liegt, die Seite ist also auch offline vollständig. */
        return fetch(RTDB + '/' + PFAD + '.json', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      })
      .then(function (m) {
        ERL = m || {};
        return Q.alle();
      })
      .then(function (jobs) {
        jobs.forEach(function (j) {                       // Lokales gewinnt
          if (j.rec === null) delete ERL[j.id]; else ERL[j.id] = j.rec;
        });
        jobsVorher = jobs.length > 0;
        $('uebLaden').style.display = 'none';
        $('uebInhalt').style.display = '';
        gestartet = true;
        aufbauen(); kopfMalen(); quellenMalen(); listeMalen();
        netzMalen(); pendSenden();
      })
      .catch(function () {
        $('uebLaden').innerHTML = '<b>uploads/pfahlueberstand.json fehlt.</b><br>'
          + 'Erst <code>PFAHLUEBERSTAND.bat</code> laufen lassen.';
      });
  }

  return { start: start,
           /* für den Selbsttest */
           _innen: function () {
             return { get pfaehle() { return pfaehle; }, get DATEN() { return DATEN; },
                      get sel() { return sel; }, set sel(v) { sel = v; },
                      get view() { return view; }, get filter() { return filter; },
                      get ERL() { return ERL; }, set ERL(v) { ERL = v; },
                      stufe: stufe, cm: cm, sichtbar: sichtbar, filterSetzen: filterSetzen,
                      detailMalen: detailMalen, listeMalen: listeMalen, kopfMalen: kopfMalen,
                      ganzeBaustelle: ganzeBaustelle, zuPfahl: zuPfahl, fertig: fertig,
                      melden: melden, zuruecknehmen: zuruecknehmen, datum: datum, Q: Q };
           } };
})();
