/*
 * nalp-auth.js — Echter Login fuer die Logistik-Seiten (Firebase Authentication,
 * E-Mail/Passwort). Ersetzt dort das Zahlen-Gate (nalp-gate.js).
 *
 * Funktionsweise (ohne Firebase-SDK, nur REST — passt zum restlichen Code):
 *  - Anmeldung:  identitytoolkit.googleapis.com  accounts:signInWithPassword
 *  - Verlaengern: securetoken.googleapis.com     (Refresh-Token, "angemeldet bleiben")
 *  - Session liegt in localStorage (nalp_auth_v1); Abmelden ueber nalpAuth.logout().
 *
 * Einbindung im <head> VOR den App-Skripten:
 *   <script>window.NALP_AUTH_TITEL = 'Logistik';</script>
 *   <script src="assets/js/nalp-auth.js"></script>
 *
 * In der Seite alle RTDB-Aufrufe ueber nalpAuth.fetch(url, opts) laufen lassen:
 * haengt ?auth=<idToken> an, wartet bis der Login steht und erneuert den Token
 * bei 401 einmalig automatisch.
 *
 * WICHTIG: API_KEY unten eintragen (Firebase Console -> Projekteinstellungen ->
 * Allgemein -> "Web-API-Schluessel"). Der Key darf oeffentlich sein — der Schutz
 * kommt aus den Datenbank-Regeln (auth != null) und den angelegten Konten.
 * Selbstregistrierung in der Console deaktivieren (Authentication ->
 * Einstellungen -> Nutzeraktionen -> "Erstellen" aus).
 */
(function () {
  'use strict';

  var API_KEY = 'HIER-WEB-API-SCHLUESSEL-EINTRAGEN';
  var TITEL = String(window.NALP_AUTH_TITEL || 'Baustellen-Portal');
  var LS_KEY = 'nalp_auth_v1';

  var session = null;      // {email, uid, idToken, refreshToken, expiresAt}
  var pending = [];        // wartende token()-Aufrufe, bis der Login steht
  var overlay = null, busy = false;

  /* ---------- Session speichern/laden ---------- */
  function load() {
    try { session = JSON.parse(window.localStorage.getItem(LS_KEY) || 'null'); }
    catch (e) { session = null; }
  }
  function save() {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(session)); } catch (e) {}
  }
  function clearSession() {
    session = null;
    try { window.localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  /* ---------- REST: Anmelden + Token erneuern ---------- */
  function fehlerText(code) {
    if (code === 'NETZ') return 'Keine Verbindung – Empfang pruefen.';
    if (code === 'KEY') return 'Einrichtungsfehler: API-Schluessel fehlt (nalp-auth.js).';
    if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(code))
      return 'E-Mail oder Passwort falsch.';
    if (/USER_DISABLED/.test(code)) return 'Dieses Konto ist gesperrt.';
    if (/TOO_MANY_ATTEMPTS/.test(code)) return 'Zu viele Versuche – bitte kurz warten.';
    return 'Anmeldung fehlgeschlagen (' + code + ').';
  }

  function login(email, pw) {
    if (API_KEY.indexOf('HIER-') === 0) return Promise.reject('KEY');
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: pw, returnSecureToken: true })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); },
            function () { throw 'NETZ'; })
      .then(function (x) {
        if (!x.ok || !x.j.idToken) throw (x.j && x.j.error && x.j.error.message) || 'FEHLER';
        session = {
          email: x.j.email || email, uid: x.j.localId || '',
          idToken: x.j.idToken, refreshToken: x.j.refreshToken,
          expiresAt: Date.now() + (parseInt(x.j.expiresIn || '3600', 10) - 60) * 1000
        };
        save();
        return session;
      });
  }

  function refresh() {
    if (!session || !session.refreshToken) return Promise.reject('KEIN_REFRESH');
    if (API_KEY.indexOf('HIER-') === 0) return Promise.reject('KEY');
    return fetch('https://securetoken.googleapis.com/v1/token?key=' + API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); },
            function () { throw 'NETZ'; })
      .then(function (x) {
        if (!x.ok || !x.j.id_token) throw (x.j && x.j.error && x.j.error.message) || 'REFRESH_FEHLER';
        session.idToken = x.j.id_token;
        session.refreshToken = x.j.refresh_token || session.refreshToken;
        session.expiresAt = Date.now() + (parseInt(x.j.expires_in || '3600', 10) - 60) * 1000;
        save();
        return session;
      });
  }

  /* ---------- Token holen (wartet notfalls auf den Login) ---------- */
  function warteAufLogin() {
    return new Promise(function (res) { pending.push(res); });
  }
  function token() {
    if (session && session.idToken && Date.now() < session.expiresAt)
      return Promise.resolve(session.idToken);
    if (session && session.refreshToken)
      return refresh().then(function () { return session.idToken; },
        function (err) {
          if (err === 'NETZ' && session && session.idToken) return session.idToken; // offline: alten Token versuchen
          clearSession(); zeigen();
          return warteAufLogin();
        });
    zeigen();
    return warteAufLogin();
  }

  /* ---------- fetch-Wrapper fuer die RTDB ---------- */
  function mitToken(url, t) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'auth=' + encodeURIComponent(t);
  }
  function authFetch(url, opts) {
    return token().then(function (t) { return fetch(mitToken(url, t), opts); })
      .then(function (r) {
        if (!r || r.status !== 401) return r;
        // Token abgelaufen/ungueltig -> genau EIN weiterer Versuch
        return refresh().then(null, function () { clearSession(); zeigen(); return warteAufLogin(); })
          .then(function () { return token(); })
          .then(function (t2) { return fetch(mitToken(url, t2), opts); });
      });
  }

  /* ---------- Login-Overlay (gleiche Optik wie das bisherige Gate) ---------- */
  var css = '' +
    '.nalp-auth-locked{overflow:hidden !important;}' +
    '#nalpAuth{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
      'padding:24px;box-sizing:border-box;font-family:Arial,"Helvetica Neue",sans-serif;color:#1a1a1a;' +
      'background:linear-gradient(rgba(20,28,38,.35),rgba(20,28,38,.55)),url(assets/img/hero.jpg) center/cover no-repeat #223041;}' +
    '#nalpAuth .na-card{width:100%;max-width:330px;text-align:center;background:#fff;border-radius:8px;' +
      'border-top:6px solid #D72622;padding:24px 20px 18px;box-shadow:0 14px 44px rgba(10,14,20,.45);}' +
    '#nalpAuth img{height:26px;margin-bottom:8px;}' +
    '#nalpAuth h1{font-size:22px;font-weight:900;margin:0 0 4px;}' +
    '#nalpAuth .na-sub{font-size:13px;color:#63676d;margin-bottom:18px;}' +
    '#nalpAuth input{width:100%;box-sizing:border-box;border:1px solid #c9ccd2;border-radius:6px;' +
      'padding:11px 10px;font-size:15px;font-family:inherit;margin-bottom:9px;}' +
    '#nalpAuth input:focus{outline:2px solid rgba(215,38,34,.35);}' +
    '#nalpAuth button{width:100%;border:none;border-radius:6px;padding:12px 16px;font-size:14.5px;' +
      'font-weight:800;cursor:pointer;color:#fff;background:#D72622;margin-top:3px;}' +
    '#nalpAuth button[disabled]{opacity:.5;}' +
    '#nalpAuth .na-msg{min-height:18px;font-size:12.5px;font-weight:700;color:#D72622;margin:8px 0 0;}' +
    '#nalpAuth .na-foot{margin-top:14px;font-size:11px;color:#8a8e94;line-height:1.5;}';

  function zeigen() {
    if (overlay) { overlay.style.display = 'flex'; return; }
    var style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    document.documentElement.classList.add('nalp-auth-locked');

    overlay = document.createElement('div');
    overlay.id = 'nalpAuth';
    overlay.innerHTML =
      '<div class="na-card">' +
        '<img src="assets/img/strabag-logo.png" alt="STRABAG">' +
        '<h1></h1>' +
        '<div class="na-sub">Mit E-Mail und Passwort anmelden</div>' +
        '<input id="naMail" type="email" autocomplete="username" placeholder="E-Mail">' +
        '<input id="naPw" type="password" autocomplete="current-password" placeholder="Passwort">' +
        '<button id="naBtn">Anmelden</button>' +
        '<div class="na-msg" id="naMsg"></div>' +
        '<div class="na-foot">Interner Baustellen-Zugang, Daten geschuetzt.<br>' +
          'Zugang/Passwort: Victor Malt, STRABAG B8-13.</div>' +
      '</div>';

    function mount() {
      overlay.querySelector('h1').textContent = TITEL;
      document.body.appendChild(overlay);
      var mail = overlay.querySelector('#naMail'), pw = overlay.querySelector('#naPw'),
          btn = overlay.querySelector('#naBtn'), msg = overlay.querySelector('#naMsg');
      try { mail.value = window.localStorage.getItem('nalp_auth_mail') || ''; } catch (e) {}

      function absenden() {
        if (busy) return;
        var m = mail.value.trim(), p = pw.value;
        if (!m || !p) { msg.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
        busy = true; btn.disabled = true; btn.textContent = 'Anmelde …'; msg.textContent = '';
        login(m, p).then(function () {
          try { window.localStorage.setItem('nalp_auth_mail', m); } catch (e) {}
          busy = false;
          overlay.style.display = 'none';
          document.documentElement.classList.remove('nalp-auth-locked');
          var warteliste = pending; pending = [];
          warteliste.forEach(function (res) { res(session.idToken); });
        }, function (err) {
          busy = false; btn.disabled = false; btn.textContent = 'Anmelden';
          msg.textContent = fehlerText(String(err));
        });
      }
      btn.addEventListener('click', absenden);
      overlay.addEventListener('keydown', function (e) { if (e.key === 'Enter') absenden(); });
      (mail.value ? pw : mail).focus();
    }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  /* ---------- oeffentliche API ---------- */
  load();
  window.nalpAuth = {
    fetch: authFetch,
    token: token,
    user: function () { return session ? session.email : null; },
    logout: function () { clearSession(); location.reload(); }
  };

  // Ohne gespeicherte Session sofort den Login zeigen (statt erst beim 1. Fetch)
  if (!session) {
    if (document.body) zeigen();
    else document.addEventListener('DOMContentLoaded', zeigen);
  }
})();
