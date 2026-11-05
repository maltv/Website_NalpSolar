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

  /* Auf portal.buildtrack.ch (unsere Adresse, 05.11.2026) läuft die API über die eigene Adresse (/api/…, nginx leitet weiter):
     gleiche Herkunft, kein CORS. Auf maltv.github.io und überall sonst wie bisher direkt api.buildtrack.ch. */
  var PORTAL = location.host === 'portal.buildtrack.ch';
  var BASIS = PORTAL ? '' : 'https://api.buildtrack.ch';
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


  /* ── Persönliche Anmeldung (Dennis 05.11.2026: «schnell anmelden, wenn kein Login da ist») ──
     Name oder E-Mail + Passwort des BuildTrack-Kontos → persönliches Token in localStorage. Damit schreiben die Seiten
     (Mängel) mit den Rechten dieser Person; ohne Anmeldung gilt nur der Lese-Schlüssel. */
  var LS_NAME = 'nalp_buildtrack_name_v1';
  function persoenlich() { var t = ''; try { t = String(localStorage.getItem(LS_TOKEN) || ''); } catch (e) {} return !!t && t !== KEY; }
  function wer() { try { return String(localStorage.getItem(LS_NAME) || ''); } catch (e) { return ''; } }
  function anmelden(name, pw) {
    var seite = (location.pathname.split('/').pop() || 'portal').replace(/\.html$/, '');
    return fetch(BASIS + '/api/v1/accounts/password-signin', {   /* PORTAL: gleiche Herkunft */
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: String(name || '').trim(), password: String(pw || ''), label: ('Website ' + seite).slice(0, 60) })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 201 && j && j.token) {
          setToken(j.token);
          var n = (j.account && (j.account.displayName || j.account.name)) || String(name || '').trim();
          try { localStorage.setItem(LS_NAME, n); } catch (e) {}
          return { ok: true, name: n };
        }
        var msg = r.status === 202 ? 'Für dieses Gerät braucht es einen Code – bitte in der Office-App anmelden.'
          : r.status === 429 ? 'Zu viele Versuche – bitte später nochmals.'
          : r.status === 403 ? 'Konto noch nicht freigeschaltet.'
          : r.status === 503 ? 'Server beschäftigt – gleich nochmals.'
          : (j && j.message) ? j.message : 'Name oder Passwort falsch.';
        return { ok: false, msg: msg };
      });
    }, function () { return { ok: false, msg: 'Kein Netz – Anmeldung geht nur mit Netz.' }; });
  }
  function abmelden() { setToken(''); try { localStorage.removeItem(LS_NAME); } catch (e) {} }
  function anmeldenDialog() {
    return new Promise(function (fertig) {
      var o = document.createElement('div');
      o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
      o.innerHTML = '<form style="background:#fff;border-radius:12px;padding:18px;max-width:340px;width:100%;font:16px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)">'
        + '<div style="font-weight:800;font-size:18px;margin-bottom:4px">BuildTrack-Anmeldung</div>'
        + '<div style="color:#555;font-size:13px;margin-bottom:12px">Damit Mängel direkt in Nalps landen.</div>'
        + '<input name="n" autocomplete="username" placeholder="Name oder E-Mail" style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:8px;font-size:16px;border:1px solid #bbb;border-radius:8px">'
        + '<input name="p" type="password" autocomplete="current-password" placeholder="Passwort" style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:8px;font-size:16px;border:1px solid #bbb;border-radius:8px">'
        + '<div data-f style="color:#D72622;font-size:13px;min-height:18px;margin-bottom:8px"></div>'
        + '<div style="display:flex;gap:8px"><button type="submit" style="flex:1;padding:10px;font-size:16px;font-weight:700;border:0;border-radius:8px;background:#1f6feb;color:#fff">Anmelden</button>'
        + '<button type="button" data-x style="padding:10px 14px;font-size:16px;border:1px solid #bbb;border-radius:8px;background:#fff">Abbrechen</button></div></form>';
      document.body.appendChild(o);
      var f = o.querySelector('form'), fehler = o.querySelector('[data-f]');
      function zu(v) { o.remove(); fertig(v); }
      o.querySelector('[data-x]').onclick = function () { zu(false); };
      f.onsubmit = function (e) {
        e.preventDefault(); fehler.textContent = '…';
        anmelden(f.n.value, f.p.value).then(function (r) { if (r.ok) zu(true); else fehler.textContent = r.msg; });
      };
      setTimeout(function () { f.n.focus(); }, 30);
    });
  }
  /* Ein kleiner Knopf: «🔑 Anmelden» oder «👤 Name» (antippen = abmelden). Ruft danach nachher() auf. */
  function knopf(el, nachher) {
    if (!el) return;
    function malen() {
      var drin = persoenlich();
      el.innerHTML = '<button type="button" style="font:inherit;font-size:13px;padding:3px 8px;border-radius:999px;border:1px solid #ccc;background:#fff">'
        + (drin ? '👤 ' + (wer() || 'angemeldet').replace(/[<>&]/g, '') : '🔑 Anmelden') + '</button>';
      el.firstChild.onclick = function () {
        if (persoenlich()) { if (confirm('Abmelden?')) { abmelden(); malen(); if (nachher) nachher(false); } return; }
        anmeldenDialog().then(function (ok) { malen(); if (ok && nachher) nachher(true); });
      };
    }
    malen();
  }

  return { BASIS: BASIS, PORTAL: PORTAL, token: token, setToken: setToken, hatToken: hatToken, q: q, ops: ops, mangelOp: mangelOp, fotoHochladen: fotoHochladen,
           persoenlich: persoenlich, wer: wer, anmelden: anmelden, abmelden: abmelden, anmeldenDialog: anmeldenDialog, knopf: knopf };
})();
