/*
 * nalp-protokoll.js — Änderungsprotokoll für alle Bearbeitungen im Portal.
 *
 * Jede Änderung (wer, wann, wo, Feld, alt → neu) wird
 *   1. lokal gesichert (localStorage, überlebt offline) und
 *   2. nach Firebase gespiegelt (erfassung/protokoll, geräteübergreifend).
 * Ansicht & Export: protokoll.html
 *
 * Einbindung:  <script src="assets/js/nalp-protokoll.js"></script>
 * Verwendung:  NALP_PROTOKOLL.log('Tabellen', 'Vorkommnis 435', 'schwere', 'Mittel', 'Hoch');
 */
(function () {
  'use strict';

  var DB = 'https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app';
  var PFAD = '/erfassung/protokoll';
  var LS = 'nalp_protokoll_v1';
  var LS_NAME = 'nalp_user_name_v1';

  function lokal() {
    try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; }
  }
  function speichern(arr) {
    try { localStorage.setItem(LS, JSON.stringify(arr.slice(-800))); } catch (e) {}
  }

  // Name des Bearbeiters: einmal fragen, dann gemerkt (änderbar in protokoll.html).
  function wer(erzwingen) {
    var n = '';
    try { n = localStorage.getItem(LS_NAME) || ''; } catch (e) {}
    if (!n || erzwingen) {
      n = (window.prompt('Dein Name fürs Änderungsprotokoll (einmalig):', n || '') || '').trim();
      if (n) { try { localStorage.setItem(LS_NAME, n); } catch (e) {} }
    }
    return n || 'unbekannt';
  }

  function nachFirebase(eintrag, lokalIdx) {
    try {
      fetch(DB + PFAD + '.json', {
        method: 'POST',
        body: JSON.stringify(eintrag)
      }).then(function (r) {
        if (!r.ok) return;
        var arr = lokal();
        if (arr[lokalIdx] && arr[lokalIdx].ts === eintrag.ts) { arr[lokalIdx].fb = true; speichern(arr); }
      }).catch(function () {});
    } catch (e) {}
  }

  // Noch nicht gespiegelte lokale Einträge nachschieben (z. B. nach Offline-Phase).
  function nachschieben() {
    var arr = lokal();
    arr.forEach(function (e, i) { if (!e.fb) nachFirebase(e, i); });
  }

  function log(seite, objekt, feld, alt, neu) {
    alt = alt == null ? '' : String(alt);
    neu = neu == null ? '' : String(neu);
    if (alt === neu) return null;
    var eintrag = {
      ts: Date.now(), seite: String(seite || ''), objekt: String(objekt || ''),
      feld: String(feld || ''), alt: alt, neu: neu, von: wer(false), fb: false
    };
    var arr = lokal(); arr.push(eintrag); speichern(arr);
    nachFirebase(eintrag, arr.length - 1);
    return eintrag;
  }

  function logAll(seite, objekt, diffs) {
    (diffs || []).forEach(function (d) { log(seite, objekt, d[0], d[1], d[2]); });
  }

  window.NALP_PROTOKOLL = {
    log: log, logAll: logAll, wer: wer,
    lokal: lokal, nachschieben: nachschieben, DB: DB, PFAD: PFAD
  };

  // still im Hintergrund nachliefern, wenn die Seite lädt
  if (window.requestIdleCallback) requestIdleCallback(nachschieben, { timeout: 4000 });
  else setTimeout(nachschieben, 2500);
})();
