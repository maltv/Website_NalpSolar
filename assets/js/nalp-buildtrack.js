/*
 * nalp-buildtrack.js — der eine Zugang der Portal-Seiten zur BuildTrack-API (api.buildtrack.ch).
 *
 * Die alten v1-Feeds (/api/v1/drillpoints/changes, /api/v1/maengel/changes, /api/v1/maengel/ops) werden
 * abgeschaltet. Hier laufen stattdessen:
 *   Lesen     GET  /api/w1/q/<view>        Query-Engine (PostgREST-Syntax: select=, <spalte>=eq.x, order=, limit=, offset=)
 *   Schreiben POST /api/v2/ops             typisierte Kommandos ({ op:'mangel.create', idempotencyKey, args })
 *   Fotos     POST /api/v1/assets/<id>?feature=maengel   (bleibt, erst das Foto, dann die Op)
 *   Dateien   GET  /api/w1/exports/<name>.csv  datei(pfad) mit demselben Zugang wie q() (assets/js/nalp-live.js, Portal)
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
 *
 * PORTAL (portal.buildtrack.ch, 05.11.2026): dort gilt KEIN Lese-Schluessel und kein Code-Gate, sondern die Anmeldung
 * der Person: nalpBT.sitzung() klaert einmal je Seitenaufruf, wer angemeldet ist — zuerst das Sitzungs-Cookie
 * (GET /api/v1/me ohne Authorization), sonst ein persoenliches Token aus localStorage (Server ohne Cookie-Sitzung).
 * nalpBT.modus() sagt danach 'cookie' | 'bearer' | null. Auf allen anderen Adressen bleibt alles wie bisher.
 * Mehrfach eingebunden (z.B. vom Gate nachgeladen) gilt die erste Fassung — ein Zustand je Seite.
 *
 * FEHLER UND RECHTE (nur PORTAL, 05.11.2026): q, datei, ops und fotoHochladen laufen dort durch EINE Stelle (portalRuf):
 *   403 → ein Kasten «Keine Berechtigung: <Recht> – bitte die Bauleitung fragen.» (einer aufs Mal, je Recht einmal je
 *         Seitenaufruf; account_pending → «Ihr Konto wartet auf Freigabe»); der Fehler traegt .recht/.rechtLabel/.code.
 *   401 → der Anmeldedialog (anmeldenDialog), danach EIN neuer Versuch; abgebrochen → der Fehler wie bisher.
 *   Option { still: true }: weder Kasten noch Dialog — fuer Aufrufe mit eigenem Rueckfall (nalp-live: die Datei).
 *   Option { haupt: true }: der Hauptinhalt der Seite (an der Aufrufstelle der Seite gesetzt). Eine 403 darauf zeigt
 *         statt des Kastens eine Seiten-Notiz «Für diese Seite fehlt Ihrem Konto: <Recht> – bitte die Bauleitung
 *         fragen.» mit «Abmelden / anderes Konto» und «Zur Startseite» — die API entscheidet, keine Liste hier (Dennis).
 * Ausserhalb des Portals ist nichts davon aktiv: dieselben Fehler, kein Kasten, kein Dialog, keine Notiz.
 */
window.nalpBT = window.nalpBT || (function () {
  'use strict';

  /* Auf portal.buildtrack.ch (unsere Adresse, 05.11.2026) läuft die API über die eigene Adresse (/api/…, nginx leitet weiter):
     gleiche Herkunft, kein CORS. Auf maltv.github.io und überall sonst wie bisher direkt api.buildtrack.ch.
     TEST-SCHALTER (nur zum lokalen Pruefen, 05.11.2026; wirkt nur auf localhost/127.0.0.1): localStorage.nalp_portal_test = '1' oder ?portal=1 in der Adresse
     → die Seite tut so, als liefe sie auf dem Portal (API dann ueber die eigene Adresse, z.B. 127.0.0.1). Sonst aendert er nichts.
     Dieselbe Pruefung steht in nalp-gate.js. */
  var PORTAL = location.host === 'portal.buildtrack.ch' || (function () {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return false;   /* Test-Schalter nur lokal, nie auf maltv.github.io */
    try { if (localStorage.getItem('nalp_portal_test') === '1') return true; } catch (e) { /* kein localStorage */ }
    return /[?&]portal=1(&|#|$)/.test(location.search || '');
  })();
  var BASIS = PORTAL ? '' : 'https://api.buildtrack.ch';
  var KEY = 'b23CBdyHH4e15koZDKATwdxR5cOaIx8iirsNA5BiX9c';   /* Lese-Schluessel (nur Bohrpunkte + Maengel lesen), Konto victor-website-read, widerrufbar; Dennis 2026-11-03 */   /* <- Victor: Lese-Schluessel hier eintragen, oder leer lassen (nur Offline-Stand) */
  var LS_TOKEN = 'nalp_buildtrack_token_v1';
  var SEITE = 5000;          /* Zeilen je Abruf; die Engine deckelt bei 10000 */
  var MAX_SEITEN = 10;

  function token() {
    var t = '';
    try { t = String(localStorage.getItem(LS_TOKEN) || ''); } catch (e) { /* kein localStorage */ }
    if (PORTAL) return t;          /* Portal: nur das persoenliche Token, nie KEY */
    return t || KEY;
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(LS_TOKEN, String(t)); else localStorage.removeItem(LS_TOKEN); } catch (e) { /* egal */ }
  }
  /* Portal: «vielleicht», solange sitzung() noch laeuft (q/ops warten darauf), danach angemeldet ja/nein. */
  function hatToken() { if (PORTAL) return !geklaert || !!modusWert; return !!token(); }

  function kopf(extra) {
    var h = {}, k;
    for (k in (extra || {})) h[k] = extra[k];
    if (PORTAL) {                  /* COOKIE: kein Authorization (das Cookie geht mit); BEARER: das persoenliche Token */
      if (modusWert === 'bearer' && token()) h['authorization'] = 'Bearer ' + token();
      return h;
    }
    var t = token();
    if (t) h['authorization'] = 'Bearer ' + t;
    return h;
  }
  /* Portal: fetch-Optionen mit dem Sitzungs-Cookie (gleiche Herkunft). Sonst unveraendert. */
  function zugang(o) { if (PORTAL) o.credentials = 'same-origin'; return o; }

  /* ── Sitzung auf dem Portal (05.11.2026) ── einmal je Seitenaufruf:
     1. GET /api/v1/me mit Cookie, ohne Authorization: 200 → COOKIE (ein altes localStorage-Token wird geloescht);
        403 (account_pending) → nicht angemeldet, grund() sagt warum.
     2. sonst, wenn ein persoenliches Token da ist: GET /api/v1/me mit diesem Token: 200 → BEARER; 401 → Token loeschen.
     3. sonst nicht angemeldet. Ergebnis: Promise<Konto|null>.
     OFFLINE: kommt von /api/v1/me gar keine Antwort (Netzfehler, keine HTTP-Antwort) und war beim letzten Seitenaufruf
     eine Sitzung bestaetigt (Merker localStorage nalp_portal_session_v1 = {modus, name, at}), liefert sitzung() ein
     Konto mit offline:true — das Gate laesst durch, offline() ist true, modus() bleibt null: Lesen geht dann wie ohne
     Anmeldung auf den mitgelieferten Stand. Ohne Merker: nicht angemeldet. Der Merker faellt bei 401/403 und Abmelden. */
  var sitzungP = null, modusWert = null, konto = null, geklaert = false, grundText = '', offlineWert = false;
  var LS_SITZUNG = 'nalp_portal_session_v1';
  function merkerSetzen() {
    try { localStorage.setItem(LS_SITZUNG, JSON.stringify({ modus: modusWert, name: wer(), at: new Date().toISOString() })); } catch (e) {}
  }
  function merkerLoeschen() { try { localStorage.removeItem(LS_SITZUNG); } catch (e) {} }
  function merkerLesen() {
    try { var m = JSON.parse(localStorage.getItem(LS_SITZUNG) || 'null'); return m && m.modus ? m : null; } catch (e) { return null; }
  }
  function meLesen(h) {
    h.accept = 'application/json';
    return holen(BASIS + '/api/v1/me', { headers: h, credentials: 'same-origin', cache: 'no-store' }, 12000)
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j || {} }; });
      }, function () { return { status: 0, j: {} }; });
  }
  function kontoAus(j) { return (j && j.account) || j || null; }
  function sitzung() {
    if (sitzungP) return sitzungP;
    if (!PORTAL) {               /* ausserhalb des Portals: der bisherige Stand, ohne Anfrage */
      modusWert = persoenlich() ? 'bearer' : null; geklaert = true;
      sitzungP = Promise.resolve(modusWert ? { displayName: wer() } : null);
      return sitzungP;
    }
    sitzungP = meLesen({}).then(function (a) {
      if (a.status === 200) { setToken(''); modusWert = 'cookie'; konto = kontoAus(a.j); merkerSetzen(); return konto; }
      if (a.status === 0) {          /* keine Antwort: offline, wenn der letzte Aufruf angemeldet war */
        var m = merkerLesen();
        if (!m) return null;
        offlineWert = true;
        return { displayName: m.name || gespeicherterName(), offline: true };
      }
      if (a.status === 403) {
        merkerLoeschen();
        var c = a.j.errorCode || a.j.error || a.j.code;
        grundText = c === 'account_pending'
          ? 'Ihr Konto ist noch nicht freigeschaltet.' : (a.j.message || 'Kein Zugang mit diesem Konto.');
        return null;
      }
      var t = token();
      if (!t) { if (a.status === 401) merkerLoeschen(); return null; }
      return meLesen({ authorization: 'Bearer ' + t }).then(function (b) {
        if (b.status === 200) { modusWert = 'bearer'; konto = kontoAus(b.j); merkerSetzen(); return konto; }
        if (b.status === 401) { setToken(''); merkerLoeschen(); }
        return null;
      });
    }).then(function (k) { geklaert = true; return k; }, function () { geklaert = true; return null; });
    return sitzungP;
  }
  function modus() { return modusWert; }
  function offline() { return offlineWert; }
  function grund() { return grundText; }
  /* Portal: vor jedem Zugriff die Sitzung abwarten; ohne Anmeldung 'kein Token' wie bisher ohne Schluessel. */
  function bereit() {
    return sitzung().then(function () { if (!modusWert) throw new Error('kein Token'); });
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
    if (PORTAL) e.antwort = r;     /* Portal: portalRuf liest daraus den Grund einer 403 (Recht) */
    return e;
  }

  /* Alle Zeilen einer Sicht: q('maengel', 'select=display_no,title&status=eq.OFFEN&order=display_no')
     Liest seitenweise (limit/offset), bis eine Seite kuerzer als SEITE ist. Ohne Token wird gar nicht erst gefragt
     (Error 'kein Token'), damit die Seiten sofort auf ihren Offline-Stand gehen. */
  function q(view, query, opt) {
    var o = opt || {};
    if (PORTAL) return portalRuf(function () { return qJetzt(view, query, o); }, o);
    if (!hatToken()) return Promise.reject(new Error('kein Token'));
    return qJetzt(view, query, o);
  }
  function qJetzt(view, query, o) {
    var alle = [], offset = 0, seiten = 0, limit = o.limit || SEITE;
    function seite() {
      var url = BASIS + '/api/w1/q/' + view + '?' + (query ? query + '&' : '') + 'limit=' + limit + '&offset=' + offset;
      return holen(url, zugang({ headers: kopf({ accept: 'application/json' }), cache: 'no-store' }), o.timeout)
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

  /* Eine Datei der API (z.B. '/api/w1/exports/table-id.csv') mit demselben Zugang wie q(): Portal Cookie bzw.
     persoenliches Token (nie KEY), sonst wie q(). Ergebnis: die Response (r.ok), sonst Error mit .status. */
  function datei(pfad, opt) {
    var o = opt || {};
    if (PORTAL) return portalRuf(function () { return dateiJetzt(pfad, o); }, o);
    if (!hatToken()) return Promise.reject(new Error('kein Token'));
    return dateiJetzt(pfad, o);
  }
  function dateiJetzt(pfad, o) {
    return holen(BASIS + pfad, zugang({ headers: kopf({ accept: o.accept || '*/*' }), cache: 'no-store' }), o.timeout || 30000)
      .then(function (r) { if (!r.ok) throw fehler(r); return r; });
  }

  /* Kommandos nach /api/v2/ops. `ops` = [{ op, idempotencyKey, args }]. Antwort: results[i] je Op mit
     status 'applied' | 'duplicate' | 'rejected' (rejected traegt error {code, message} und ist ENDGUELTIG).
     Geworfen wird nur, wenn die Anfrage selbst nicht durchkam (dann darf und muss wiederholt werden). */
  function ops(liste, opt) {
    if (PORTAL) return portalRuf(function () { return opsJetzt(liste); }, opt || {});
    if (!hatToken()) return Promise.reject(new Error('kein Token'));
    return opsJetzt(liste);
  }
  function opsJetzt(liste) {
    return holen(BASIS + '/api/v2/ops', zugang({
      method: 'POST', headers: kopf({ 'content-type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify({ ops: liste })
    }), 20000).then(function (r) {
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

  /* Foto hochladen (Mangel-Foto). true = angenommen (auch wenn es schon da war).
     Portal: 401/403 laufen durch portalRuf (Dialog bzw. Kasten) und werfen dann (Fehler mit .status/.recht), damit eine
     Warteschlange eine Verweigerung erkennt; alles andere wie bisher true/false. */
  function fotoHochladen(id, blob, opt) {
    if (PORTAL) return sitzung().then(function () {   /* ohne Anmeldung: nicht angenommen */
      return modusWert ? portalRuf(function () { return fotoPortal(id, blob); }, opt || {}) : false;
    });
    return fotoJetzt(id, blob);
  }
  function fotoPortal(id, blob) {
    return fotoAnfrage(id, blob).then(function (r) { if (r.status === 401 || r.status === 403) throw fehler(r); return r.ok; });
  }
  function fotoJetzt(id, blob) {
    return fotoAnfrage(id, blob).then(function (r) { return r.ok; });
  }
  function fotoAnfrage(id, blob) {
    return holen(BASIS + '/api/v1/assets/' + encodeURIComponent(id) + '?feature=maengel', zugang({
      method: 'POST', headers: kopf({ 'content-type': blob.type || 'image/jpeg' }), body: blob
    }), 60000);
  }

  /* ── Rechte und Fehler auf dem Portal (05.11.2026) ──
     Die deutschen Namen der Rechte: das kurze `label` aus der Office-App (src/domain/config/permissions.ts,
     PERMISSION_LABELS) — nur die, die die API bei den Aufrufen dieser Seiten nennen kann. Unbekannt → der Name. */
  var RECHT_LABEL = {
    'accounts:self': 'Eigenes Konto',
    'plan:read': 'Plan: Tische, Bohrpunkte (Soll), Geometrie, Bereiche, Kartenebenen',
    'drill:read': 'Bohrstand und Bohrverlauf',
    'maengel:read': 'Mängel',
    'standorte:read': 'Standorte',
    'topo:read': 'Topo-Punkte',
    'photos:read': 'Fotos',
    'office:read': 'Büro: Freigaben, Bestellungen, Passstücke, Ausmass, Verlauf, Werkleitungen',
    'freigabe:read': 'Freigaben an ILF und ihre Antworten',
    'documents:read': 'Dokumente',
    'field:write': 'Felddaten erfassen (Bohrstand, Mängel, Standorte, Topo-Punkte)',
    'assets:write': 'Fotos hochladen',
    'drill:write': 'Bohrstand erfassen',
    'maengel:resolve:any': 'Jeden Mangel erledigen oder löschen',
    'app:map': 'Karte', 'app:drill': 'Bohr-App', 'app:issues': 'Mängel-App', 'app:vormontage': 'Vormontage', 'app:office': 'Office'
  };
  function rechtLabel(p) {
    p = String(p || '');
    return Object.prototype.hasOwnProperty.call(RECHT_LABEL, p) ? RECHT_LABEL[p] : p;
  }

  /* Der Kasten bei einer 403: einer aufs Mal, je Recht (bzw. «wartet auf Freigabe») einmal je Seitenaufruf. */
  var kastenOffen = false, kastenGezeigt = {};
  function kasten(text, schluessel) {
    if (!PORTAL || kastenOffen || kastenGezeigt[schluessel] || !document.body) return;
    if (document.getElementById('nalpBtNotiz')) return;     /* die Seiten-Notiz sagt es schon */
    kastenGezeigt[schluessel] = 1; kastenOffen = true;
    var k = document.createElement('div');
    k.id = 'nalpBtKasten'; k.setAttribute('role', 'alert');
    k.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9998;box-sizing:border-box;'
      + 'width:calc(100% - 32px);max-width:420px;background:#fff;color:#1a1a1a;border-left:6px solid #D72622;border-radius:8px;'
      + 'box-shadow:0 8px 30px rgba(0,0,0,.3);padding:12px 12px 12px 14px;font:14px/1.4 system-ui,Arial,sans-serif;display:flex;gap:10px;align-items:flex-start';
    var t = document.createElement('div'); t.style.flex = '1'; t.textContent = text;
    var x = document.createElement('button'); x.type = 'button'; x.textContent = 'Schliessen';
    x.style.cssText = 'flex:none;padding:6px 10px;font-size:13px;border:1px solid #bbb;border-radius:6px;background:#fff;cursor:pointer';
    x.onclick = function () { if (k.parentNode) k.parentNode.removeChild(k); kastenOffen = false; };
    k.appendChild(t); k.appendChild(x); document.body.appendChild(k);
  }
  function verweigertText(e) {
    if (e.ausstehend) return 'Ihr Konto wartet auf Freigabe – bitte die Bauleitung fragen.';
    return 'Keine Berechtigung: ' + (e.rechtLabel || 'diese Funktion') + ' – bitte die Bauleitung fragen.';
  }
  /* Die Seiten-Notiz: der Hauptinhalt der Seite (Option haupt) wurde verweigert — statt einer leeren Seite. */
  function seitenNotiz(e) {
    if (!PORTAL || !document.body || document.getElementById('nalpBtNotiz')) return;
    var k = document.getElementById('nalpBtKasten');
    if (k && k.parentNode) { k.parentNode.removeChild(k); kastenOffen = false; }
    var n = document.createElement('div');
    n.id = 'nalpBtNotiz'; n.setAttribute('role', 'alert');
    n.style.cssText = 'position:fixed;inset:0;z-index:9997;background:#eef0f2;display:flex;align-items:center;justify-content:center;'
      + 'padding:16px;box-sizing:border-box;font:15px/1.45 system-ui,Arial,sans-serif;color:#1a1a1a';
    var c = document.createElement('div');
    c.style.cssText = 'background:#fff;border-top:6px solid #D72622;border-radius:8px;max-width:380px;width:100%;padding:20px;'
      + 'box-sizing:border-box;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    var t = document.createElement('div'); t.style.cssText = 'font-weight:700;margin-bottom:14px';
    t.textContent = e.ausstehend ? 'Ihr Konto wartet auf Freigabe – bitte die Bauleitung fragen.'
      : 'Für diese Seite fehlt Ihrem Konto: ' + (e.rechtLabel || 'eine Berechtigung') + ' – bitte die Bauleitung fragen.';
    var aus = document.createElement('button'); aus.type = 'button'; aus.textContent = 'Abmelden / anderes Konto';
    aus.style.cssText = 'display:block;width:100%;padding:11px;font-size:16px;font-weight:700;border:0;border-radius:6px;background:#D72622;color:#fff;cursor:pointer';
    aus.onclick = function () {
      aus.disabled = true;
      var neu = function () { location.reload(); };
      Promise.resolve(abmelden()).then(neu, neu);      /* nach dem Neuladen fragt das Gate die Anmeldung */
    };
    var heim = document.createElement('a'); heim.href = 'index.html'; heim.textContent = 'Zur Startseite';
    heim.style.cssText = 'display:block;text-align:center;margin-top:12px;color:#63676d;font-size:14px';
    c.appendChild(t); c.appendChild(aus); c.appendChild(heim); n.appendChild(c); document.body.appendChild(n);
  }
  /* Auch fuer die Seiten: eine Verweigerung, die nicht als 403 kam (v2-Op «rejected: forbidden», message = das Recht). */
  function verweigert(recht) {
    var e = { recht: String(recht || ''), rechtLabel: recht ? rechtLabel(recht) : '' };
    kasten(verweigertText(e), 'r:' + e.recht);
    return e.rechtLabel;
  }
  /* 403: den Grund aus der Antwort lesen ({error, permission, errorCode?}) und an den Fehler haengen. */
  function grundLesen(e) {
    var r = e && e.antwort;
    if (!r || e.status !== 403) return Promise.resolve(e);
    return r.json().catch(function () { return {}; }).then(function (j) {
      j = j || {};
      e.recht = String(j.permission || ''); e.code = String(j.errorCode || j.error || '');
      e.ausstehend = e.code === 'account_pending';
      e.rechtLabel = e.recht ? rechtLabel(e.recht) : '';
      return e;
    });
  }
  var dialogP = null;     /* mehrere 401 gleichzeitig: EIN Dialog */
  function dialogEinmal() {
    if (!dialogP) dialogP = anmeldenDialog('Ihre Anmeldung ist abgelaufen – bitte melden Sie sich neu an.')
      .then(function (ok) { dialogP = null; return ok; });
    return dialogP;
  }
  /* Die eine Stelle fuer alle API-Aufrufe auf dem Portal: Sitzung abwarten, aufrufen, 401/403 behandeln (siehe oben). */
  function portalRuf(fn, o) {
    o = o || {};
    function pruefen(e, ersterVersuch) {
      return grundLesen(e).then(function (e) {
        if (!o.still && e && e.status === 401 && ersterVersuch) {
          return dialogEinmal().then(function (ok) {
            if (!ok) throw e;
            return fn().catch(function (e2) { return pruefen(e2, false); });
          });
        }
        if (!o.still && e && e.status === 403 && o.haupt) seitenNotiz(e);
        else if (!o.still && e && e.status === 403) kasten(verweigertText(e), e.ausstehend ? 'pending' : 'r:' + (e.recht || ''));
        throw e;
      });
    }
    return bereit().then(function () { return fn(); }).catch(function (e) {
      if (!e || !e.status) throw e;          /* kein Token, Netz, Abbruch: wie bisher */
      return pruefen(e, true);
    });
  }


  /* ── Persönliche Anmeldung (Dennis 05.11.2026: «schnell anmelden, wenn kein Login da ist») ──
     Name oder E-Mail + Passwort des BuildTrack-Kontos → persönliches Token in localStorage. Damit schreiben die Seiten
     (Mängel) mit den Rechten dieser Person; ohne Anmeldung gilt nur der Lese-Schlüssel. */
  var LS_NAME = 'nalp_buildtrack_name_v1';
  function persoenlich() {
    if (PORTAL) return !!modusWert;     /* Portal: angemeldet (Cookie oder Token), sobald sitzung() es weiss */
    var t = ''; try { t = String(localStorage.getItem(LS_TOKEN) || ''); } catch (e) {} return !!t && t !== KEY;
  }
  function gespeicherterName() { try { return String(localStorage.getItem(LS_NAME) || ''); } catch (e) { return ''; } }
  function wer() {
    if (PORTAL && konto && (konto.displayName || konto.name)) return String(konto.displayName || konto.name);
    return gespeicherterName();
  }
  function anmelden(name, pw) {
    if (PORTAL) return anmeldenPortal(name, pw);
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
  function abmelden() {
    if (PORTAL) return abmeldenPortal();
    setToken(''); try { localStorage.removeItem(LS_NAME); } catch (e) {}
  }

  /* ── Anmeldung auf dem Portal (05.11.2026) ── wie oben, aber mit x-nalps-session: cookie. Der Server antwortet
     201 {session:'cookie'} (Sitzungs-Cookie gesetzt) oder 201 {token} (Server ohne Cookie-Sitzung: Token wie bisher),
     202 {challenge, sentTo} = neues Geraet: es braucht den geschickten Code → codeBestaetigen(challenge, code).
     Ergebnis: { ok, name } | { ok:false, msg } | { ok:false, code:true, challenge, sentTo, msg }. */
  function portalAntwort(r, name) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      j = j || {};
      if (r.status === 201 && (j.session === 'cookie' || j.token)) {
        if (j.session === 'cookie') { setToken(''); modusWert = 'cookie'; } else { setToken(j.token); modusWert = 'bearer'; }
        konto = j.account || konto;
        var n = (j.account && (j.account.displayName || j.account.name)) || String(name || '').trim();
        try { localStorage.setItem(LS_NAME, n); } catch (e) {}
        geklaert = true; grundText = ''; offlineWert = false; sitzungP = Promise.resolve(konto || { displayName: n });
        merkerSetzen();
        return { ok: true, name: n };
      }
      if (r.status === 202 && j.challenge) {
        return { ok: false, code: true, challenge: j.challenge, sentTo: j.sentTo || '',
                 msg: 'Neues Gerät: wir haben Ihnen einen Code geschickt' + (j.sentTo ? ' (an ' + j.sentTo + ')' : '') + '. Bitte geben Sie ihn ein.' };
      }
      var msg = r.status === 429 ? 'Zu viele Versuche – bitte später nochmals.'
        : r.status === 403 ? 'Konto noch nicht freigeschaltet.'
        : r.status === 503 ? 'Server beschäftigt – gleich nochmals.'
        : j.message ? j.message : 'Name oder Passwort falsch.';
      return { ok: false, msg: msg };
    });
  }
  function portalPost(pfad, body) {
    return fetch(BASIS + pfad, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-nalps-session': 'cookie' },
      body: JSON.stringify(body)
    });
  }
  function anmeldenPortal(name, pw) {
    var seite = (location.pathname.split('/').pop() || 'portal').replace(/\.html$/, '');
    return portalPost('/api/v1/accounts/password-signin', {
      email: String(name || '').trim(), password: String(pw || ''), label: ('Website ' + seite).slice(0, 60), app: 'portal.buildtrack.ch'
    }).then(function (r) { return portalAntwort(r, name); },
            function () { return { ok: false, msg: 'Kein Netz – Anmeldung geht nur mit Netz.' }; });
  }
  function codeBestaetigen(challenge, code, name) {
    return portalPost('/api/v1/accounts/device-verify', { challenge: challenge, code: String(code || '').trim() })
      .then(function (r) {
        if (r.status === 401 || r.status === 400) return { ok: false, msg: 'Code falsch oder abgelaufen.' };
        return portalAntwort(r, name);
      }, function () { return { ok: false, msg: 'Kein Netz – Anmeldung geht nur mit Netz.' }; });
  }
  function abmeldenPortal() {
    var war = modusWert;
    modusWert = null; konto = null; geklaert = true; offlineWert = false; sitzungP = Promise.resolve(null);
    merkerLoeschen(); setToken(''); try { localStorage.removeItem(LS_NAME); } catch (e) {}
    if (war !== 'cookie') return Promise.resolve();
    return fetch(BASIS + '/api/v1/me/sign-out', { method: 'POST', credentials: 'same-origin' })
      .then(function () {}, function () {});
  }
  function anmeldenDialog(untertitel) {     /* untertitel: nur portalRuf gibt einen (abgelaufene Anmeldung) */
    return new Promise(function (fertig) {
      var o = document.createElement('div');
      o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
      o.innerHTML = '<form style="background:#fff;border-radius:12px;padding:18px;max-width:340px;width:100%;font:16px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)">'
        + '<div style="font-weight:800;font-size:18px;margin-bottom:4px">BuildTrack-Anmeldung</div>'
        + '<div style="color:#555;font-size:13px;margin-bottom:12px">Damit Mängel direkt in Nalps landen.</div>'
        + '<input name="n" autocomplete="username" placeholder="Name oder E-Mail" style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:8px;font-size:16px;border:1px solid #bbb;border-radius:8px">'
        + '<input name="p" type="password" autocomplete="current-password" placeholder="Passwort" style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:8px;font-size:16px;border:1px solid #bbb;border-radius:8px">'
        + (PORTAL ? '<input name="c" inputmode="numeric" autocomplete="one-time-code" placeholder="Code" style="display:none;width:100%;box-sizing:border-box;padding:10px;margin-bottom:8px;font-size:16px;border:1px solid #bbb;border-radius:8px">' : '')
        + '<div data-f style="color:#D72622;font-size:13px;min-height:18px;margin-bottom:8px"></div>'
        + '<div style="display:flex;gap:8px"><button type="submit" style="flex:1;padding:10px;font-size:16px;font-weight:700;border:0;border-radius:8px;background:#1f6feb;color:#fff">Anmelden</button>'
        + '<button type="button" data-x style="padding:10px 14px;font-size:16px;border:1px solid #bbb;border-radius:8px;background:#fff">Abbrechen</button></div></form>';
      if (untertitel) o.querySelector('form').children[1].textContent = String(untertitel);   /* der graue Satz unter dem Titel */
      document.body.appendChild(o);
      var f = o.querySelector('form'), fehler = o.querySelector('[data-f]');
      function zu(v) { o.remove(); fertig(v); }
      o.querySelector('[data-x]').onclick = function () { zu(false); };
      var challenge = null;      /* Portal: nach 202 der zweite Schritt (Code) im selben Dialog */
      function nachAntwort(r) {
        if (r.ok) { zu(true); return; }
        if (r.code) {
          challenge = r.challenge;
          f.n.style.display = 'none'; f.p.style.display = 'none'; f.c.style.display = ''; f.c.value = '';
          setTimeout(function () { f.c.focus(); }, 30);
        }
        fehler.textContent = r.msg;
      }
      f.onsubmit = function (e) {
        e.preventDefault(); fehler.textContent = '…';
        if (challenge) codeBestaetigen(challenge, f.c.value, f.n.value).then(nachAntwort);
        else anmelden(f.n.value, f.p.value).then(nachAntwort);
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
    /* Portal: sobald die Sitzung geklaert ist, richtig anzeigen — und ist sie angemeldet, nachher(true) wie nach
       einer Anmeldung ueber den Knopf (inventur sendet dann seine Warteschlange). */
    if (PORTAL) sitzung().then(function () { malen(); if (modusWert && nachher) nachher(true); });
  }

  return { BASIS: BASIS, PORTAL: PORTAL, token: token, setToken: setToken, hatToken: hatToken, q: q, datei: datei, ops: ops, mangelOp: mangelOp, fotoHochladen: fotoHochladen,
           persoenlich: persoenlich, wer: wer, anmelden: anmelden, abmelden: abmelden, anmeldenDialog: anmeldenDialog, knopf: knopf,
           sitzung: sitzung, modus: modus, offline: offline, grund: grund, codeBestaetigen: codeBestaetigen,
           rechtLabel: rechtLabel, verweigert: verweigert };
})();
