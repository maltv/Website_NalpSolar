/*
 * nalp-buildtrack.js — der eine Zugang der Portal-Seiten zur BuildTrack-API (api.buildtrack.ch).
 *
 * Die alten v1-Feeds (/api/v1/drillpoints/changes, /api/v1/maengel/changes, /api/v1/maengel/ops) werden
 * abgeschaltet. Hier laufen stattdessen:
 *   Lesen     GET  /api/w1/q/<view>        Query-Engine (PostgREST-Syntax: select=, <spalte>=eq.x, order=, limit=, offset=)
 *   Schreiben POST /api/v2/ops             typisierte Kommandos ({ op:'mangel.create', idempotencyKey, args })
 *   Fotos     POST /api/v1/assets/<id>?feature=maengel   (bleibt, erst das Foto, dann die Op)
 *
 * ZUGANG: alle drei Wege verlangen ein Token (Authorization: Bearer …). Die v1-Feeds waren ohne Token lesbar, die
 * neuen Wege sind es nicht. Das Token kommt
 *   1. aus localStorage['nalp_buildtrack_token_v1']  (einmal je Browser setzen: nalpBT.setToken('…') in der Konsole), sonst
 *   2. aus der Konstante KEY unten  (ein LESE-Schluessel eines Service-Kontos mit den Bereichen drill:read + maengel:read;
 *      er steht dann im Quelltext — wie der Firebase-Key und der Gate-Code — und ist nur so viel wert wie diese Bereiche).
 * Ohne Token lesen die Seiten ihren mitgelieferten Stand (uploads/…) und melden «kein Zugang»; Mangel-Meldungen
 * (verschrauben.html) bleiben dann in der Warteschlange, bis ein Token da ist.
 *
 * Einbindung VOR dem Seitenskript:  <script src="assets/js/nalp-buildtrack.js"></script>
 */
window.nalpBT = (function () {
  'use strict';

  var BASIS = 'https://api.buildtrack.ch';
  var KEY = 'b23CBdyHH4e15koZDKATwdxR5cOaIx8iirsNA5BiX9c';   /* Lese-Schluessel (nur Bohrpunkte + Maengel lesen), Konto victor-website-read, widerrufbar; Dennis 2026-11-03 */   /* <- Victor: Lese-Schluessel hier eintragen, oder leer lassen (nur Offline-Stand) */
  var LS_TOKEN = 'nalp_buildtrack_token_v1';
  var SEITE = 5000;          /* Zeilen je Abruf; die Engine deckelt bei 10000 */
  var MAX_SEITEN = 10;

  function token() {
    var t = '';
    try { t = String(localStorage.getItem(LS_TOKEN) || ''); } catch (e) { /* kein localStorage */ }
    return t || KEY;
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(LS_TOKEN, String(t)); else localStorage.removeItem(LS_TOKEN); } catch (e) { /* egal */ }
  }
  function hatToken() { return !!token(); }

  function kopf(extra) {
    var h = {}, k;
    for (k in (extra || {})) h[k] = extra[k];
    var t = token();
    if (t) h['authorization'] = 'Bearer ' + t;
    return h;
  }

  /* fetch mit Abbruch nach `ms` Millisekunden (die Seiten warten nicht ewig auf den Berg-Empfang). */
  function holen(url, opts, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 12000);
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) { clearTimeout(to); return r; }, function (e) { clearTimeout(to); throw e; });
  }

  function fehler(r) {
    var e = new Error('buildtrack ' + r.status);
    e.status = r.status;
    return e;
  }

  /* Alle Zeilen einer Sicht: q('maengel', 'select=display_no,title&status=eq.OFFEN&order=display_no')
     Liest seitenweise (limit/offset), bis eine Seite kuerzer als SEITE ist. Ohne Token wird gar nicht erst gefragt
     (Error 'kein Token'), damit die Seiten sofort auf ihren Offline-Stand gehen. */
  function q(view, query, opt) {
    var o = opt || {};
    if (!hatToken()) return Promise.reject(new Error('kein Token'));
    var alle = [], offset = 0, seiten = 0, limit = o.limit || SEITE;
    function seite() {
      var url = BASIS + '/api/w1/q/' + view + '?' + (query ? query + '&' : '') + 'limit=' + limit + '&offset=' + offset;
      return holen(url, { headers: kopf({ accept: 'application/json' }), cache: 'no-store' }, o.timeout)
        .then(function (r) {
          if (r.status === 416) return [];              /* offset hinter der letzten Zeile: nichts mehr */
          if (!r.ok) throw fehler(r);
          return r.json();
        })
        .then(function (rows) {
          rows = Array.isArray(rows) ? rows : [];
          alle = alle.concat(rows);
          seiten++;
          if (rows.length < limit || seiten >= MAX_SEITEN) return alle;
          offset += rows.length;
          return seite();
        });
    }
    return seite();
  }

  /* Kommandos nach /api/v2/ops. `ops` = [{ op, idempotencyKey, args }]. Antwort: results[i] je Op mit
     status 'applied' | 'duplicate' | 'rejected' (rejected traegt error {code, message} und ist ENDGUELTIG).
     Geworfen wird nur, wenn die Anfrage selbst nicht durchkam (dann darf und muss wiederholt werden). */
  function ops(liste) {
    if (!hatToken()) return Promise.reject(new Error('kein Token'));
    return holen(BASIS + '/api/v2/ops', {
      method: 'POST', headers: kopf({ 'content-type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify({ ops: liste })
    }, 20000).then(function (r) {
      if (!r.ok) throw fehler(r);
      return r.json();
    }).then(function (j) { return (j && j.results) || []; });
  }

  /* Die v1-Mangel-Ops der Seiten ({kind:'create_mangel', idempotencyKey, …}) als v2-Kommando: der Kind-Name wird zum
     Kommando, der Rest sind die args — dasselbe Schema, der Server prueft beide Wege gegen eines. */
  var KIND_ZU_OP = {
    create_mangel: 'mangel.create', add_post: 'mangel.post', set_status: 'mangel.setStatus', edit_mangel: 'mangel.edit',
    delete_mangel: 'mangel.delete', merge_mangel: 'mangel.merge', unmerge_mangel: 'mangel.unmerge', assign_mangel: 'mangel.assign'
  };
  function mangelOp(v1) {
    var args = {}, k;
    for (k in v1) if (k !== 'kind' && k !== 'idempotencyKey') args[k] = v1[k];
    return { op: KIND_ZU_OP[v1.kind] || v1.kind, idempotencyKey: v1.idempotencyKey, args: args };
  }

  /* Foto hochladen (Mangel-Foto). true = angenommen (auch wenn es schon da war). */
  function fotoHochladen(id, blob) {
    return holen(BASIS + '/api/v1/assets/' + encodeURIComponent(id) + '?feature=maengel', {
      method: 'POST', headers: kopf({ 'content-type': blob.type || 'image/jpeg' }), body: blob
    }, 60000).then(function (r) { return r.ok; });
  }

  return { BASIS: BASIS, token: token, setToken: setToken, hatToken: hatToken, q: q, ops: ops, mangelOp: mangelOp, fotoHochladen: fotoHochladen };
})();
