/*
 * nalp-gate.js — Zugangs-Gate fuer das NalpSolar Baustellen-Portal.
 *
 * ACHTUNG: Client-seitiges "Soft-Gate". Haelt normale Besucher mit dem Code
 * fern, ist aber KEIN echter Schutz (Code steht im Quelltext). Fuer echten
 * Schutz waere Firebase-Auth / Server-Passwort noetig.
 *
 * Einbindung: <script src="assets/js/nalp-gate.js"></script> im <head> JEDER
 * geschuetzten Seite, moeglichst frueh (vor den grossen App-Skripten).
 * Optional VOR dem Include konfigurierbar (z.B. Logistik mit eigenem Code):
 *   window.NALP_GATE_CODE  = '7188';
 *   window.NALP_GATE_KEY   = 'nalp_logistik_unlock_v1';
 *   window.NALP_GATE_TITEL = 'Logistik';
 *   window.NALP_GATE_SUB   = 'Code = PLZ Sedrun';
 *
 * PORTAL (portal.buildtrack.ch, 05.11.2026): dort gibt es kein Tastenfeld und keinen Code (auch nicht die strengeren
 * 8813/7188 — Dennis: «ein angemeldeter BuildTrack-Benutzer kommt durch»). Das Gate fragt nalpBT.sitzung()
 * (assets/js/nalp-buildtrack.js, wird nachgeladen, falls die Seite es nicht selbst einbindet): angemeldet → frei,
 * sonst die BuildTrack-Anmeldung (Name oder E-Mail + Passwort, bei neuem Geraet der Code). Kein localStorage-Flag.
 * Test-Schalter wie in nalp-buildtrack.js: localStorage.nalp_portal_test = '1' oder ?portal=1 (nur zum lokalen Pruefen).
 */
(function () {
  'use strict';

  var CODE = String(window.NALP_GATE_CODE || '6460');            // Zugangscode
  var KEY  = String(window.NALP_GATE_KEY  || 'nalp_portal_unlock_v1');  // localStorage-Flag
  var TITEL = String(window.NALP_GATE_TITEL || 'Baustellen-Portal');
  var SUB   = String(window.NALP_GATE_SUB   || 'Code eingeben, um fortzufahren');
  var MAXLEN = CODE.length;
  var PORTAL = window.location.host === 'portal.buildtrack.ch' || (function () {
    try { if (window.localStorage.getItem('nalp_portal_test') === '1') return true; } catch (e) { /* privater Modus */ }
    return /[?&]portal=1(&|#|$)/.test(window.location.search || '');
  })();
  var SELBST = (document.currentScript && document.currentScript.src) || '';   // fuer den Pfad von nalp-buildtrack.js

  if (!PORTAL) {
  // Bereits freigeschaltet? -> nichts tun.
  try { if (window.localStorage.getItem(KEY) === '1') return; } catch (e) { /* privater Modus */ }

  // Freischaltung per Link: ...?k=6460 (fuer QR-Aushaenge, damit der Code
  // nicht lesbar auf dem Blatt stehen muss). Der Code wird sofort aus der
  // Adresszeile entfernt, damit er nicht im Verlauf/Screenshot auftaucht.
  try {
    var mk = /[?&]k=([0-9]{3,8})/.exec(window.location.search || '');
    if (mk && mk[1] === CODE) {
      window.localStorage.setItem(KEY, '1');
      if (window.history && window.history.replaceState) {
        var sauber = (window.location.search || '').replace(/([?&])k=[0-9]{3,8}&?/, '$1').replace(/[?&]$/, '');
        window.history.replaceState({}, '', window.location.pathname + sauber + window.location.hash);
      }
      return;
    }
  } catch (e) { /* egal, dann kommt das Tastenfeld */ }
  }

  // Scroll/Interaktion sperren bis freigeschaltet.
  var htmlEl = document.documentElement;
  htmlEl.classList.add('nalp-gate-locked');

  // STRABAG-CI: weisse Karte mit rotem Balken auf dem Nalps-Drohnenfoto
  var css = '' +
    '.nalp-gate-locked{overflow:hidden !important;}' +
    '#nalpGate{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;padding:24px;box-sizing:border-box;' +
      'font-family:Arial,"Helvetica Neue",sans-serif;color:#1a1a1a;' +
      'background:linear-gradient(rgba(20,28,38,.35),rgba(20,28,38,.55)),' +
        'url(assets/img/hero.jpg) center/cover no-repeat #223041;' +
      '-webkit-tap-highlight-color:transparent;user-select:none;}' +
    '#nalpGate .ng-sun,#nalpGate .ng-mtn{display:none;}' +
    '#nalpGate .ng-card{position:relative;z-index:2;width:100%;max-width:330px;text-align:center;' +
      'background:#fff;border-radius:8px;border-top:6px solid #D72622;' +
      'padding:24px 20px 20px;box-shadow:0 14px 44px rgba(10,14,20,.45);}' +
    '#nalpGate .ng-brand{margin-bottom:8px;}' +
    '#nalpGate .ng-brand img{height:26px;display:inline-block;}' +
    '#nalpGate h1{font-size:24px;font-weight:900;margin:0 0 4px;letter-spacing:.01em;}' +
    '#nalpGate .ng-sub{font-size:13px;color:#63676d;margin-bottom:22px;}' +
    '#nalpGate .ng-dots{display:flex;gap:16px;justify-content:center;margin-bottom:8px;height:20px;}' +
    '#nalpGate .ng-dot{width:15px;height:15px;border-radius:50%;border:2px solid #b8bcc3;' +
      'transition:transform .12s,background .12s,border-color .12s;}' +
    '#nalpGate .ng-dot.on{background:#D72622;border-color:#D72622;transform:scale(1.12);}' +
    '#nalpGate .ng-msg{height:20px;font-size:13px;font-weight:700;color:#D72622;margin-bottom:12px;opacity:0;transition:opacity .15s;}' +
    '#nalpGate .ng-msg.show{opacity:1;}' +
    '#nalpGate.shake .ng-dots{animation:ngShake .38s;}' +
    '@keyframes ngShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(9px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}' +
    '#nalpGate .ng-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:270px;margin:0 auto;}' +
    '#nalpGate .ng-key{aspect-ratio:1/1;border:none;border-radius:50%;font-size:25px;font-weight:700;' +
      'color:#1a1a1a;background:#f0f1f3;box-shadow:inset 0 0 0 1px #d5d8dd;' +
      'cursor:pointer;touch-action:manipulation;transition:background .12s,transform .06s;}' +
    '#nalpGate .ng-key:active{background:rgba(215,38,34,.3);transform:scale(.94);}' +
    '#nalpGate .ng-key.ghost{background:none;box-shadow:none;font-size:15px;font-weight:700;color:#63676d;}' +
    '#nalpGate .ng-foot{margin-top:18px;font-size:11px;color:#8a8e94;line-height:1.5;}' +
    '#nalpGate.ng-out{opacity:0;transform:scale(1.04);transition:opacity .35s,transform .35s;pointer-events:none;}';
  if (PORTAL) css +=
    '#nalpGate form{text-align:left;margin:0;}' +
    '#nalpGate input{display:block;width:100%;box-sizing:border-box;padding:11px 12px;margin:0 0 10px;font-size:16px;' +
      'border:1px solid #c4c8ce;border-radius:6px;background:#fff;color:#1a1a1a;user-select:text;-webkit-user-select:text;}' +
    '#nalpGate .ng-ok{display:block;width:100%;padding:12px;font-size:16px;font-weight:700;border:0;border-radius:6px;' +
      'background:#D72622;color:#fff;cursor:pointer;}' +
    '#nalpGate .ng-ok[disabled]{opacity:.6;cursor:default;}' +
    '#nalpGate .ng-back{display:block;margin:10px auto 0;border:0;background:none;color:#63676d;font-size:13px;cursor:pointer;}' +
    '#nalpGate .ng-pmsg{min-height:18px;font-size:13px;font-weight:700;color:#D72622;margin:0 0 10px;}' +
    '#nalpGate .ng-pmsg.info{color:#63676d;font-weight:400;}';

  var style = document.createElement('style');
  style.textContent = css;
  (document.head || htmlEl).appendChild(style);

  var gate = document.createElement('div');
  gate.id = 'nalpGate';
  if (PORTAL) gate.innerHTML =
    '<div class="ng-card">' +
      '<div class="ng-brand"><img src="assets/img/strabag-logo.png" alt="STRABAG"></div>' +
      '<h1></h1>' +
      '<div class="ng-sub">Mit BuildTrack anmelden</div>' +
      '<form id="ngForm" novalidate>' +
        '<div class="ng-pmsg info" id="ngPMsg">Anmeldung wird geprüft …</div>' +
        '<div id="ngSchritt1" style="display:none">' +
          '<input name="n" autocomplete="username" placeholder="Name oder E-Mail" aria-label="Name oder E-Mail">' +
          '<input name="p" type="password" autocomplete="current-password" placeholder="Passwort" aria-label="Passwort">' +
        '</div>' +
        '<div id="ngSchritt2" style="display:none">' +
          '<input name="c" inputmode="numeric" autocomplete="one-time-code" placeholder="Code" aria-label="Code">' +
        '</div>' +
        '<button type="submit" class="ng-ok" id="ngOk" style="display:none">Anmelden</button>' +
        '<button type="button" class="ng-back" id="ngZurueck" style="display:none">Zurück</button>' +
      '</form>' +
      '<div class="ng-foot">Interner Baustellen-Zugang mit Ihrem BuildTrack-Konto. Bei Fragen: Victor Malt, STRABAG B8-13.</div>' +
    '</div>';
  else gate.innerHTML =
    '<div class="ng-sun"></div>' +
    '<div class="ng-card">' +
      '<div class="ng-brand"><img src="assets/img/strabag-logo.png" alt="STRABAG"></div>' +
      '<h1></h1>' +
      '<div class="ng-sub"></div>' +
      '<div class="ng-dots">' +
        '<span class="ng-dot"></span><span class="ng-dot"></span>' +
        '<span class="ng-dot"></span><span class="ng-dot"></span>' +
      '</div>' +
      '<div class="ng-msg" id="ngMsg"></div>' +
      '<div class="ng-pad" id="ngPad">' +
        '<button class="ng-key" data-k="1">1</button>' +
        '<button class="ng-key" data-k="2">2</button>' +
        '<button class="ng-key" data-k="3">3</button>' +
        '<button class="ng-key" data-k="4">4</button>' +
        '<button class="ng-key" data-k="5">5</button>' +
        '<button class="ng-key" data-k="6">6</button>' +
        '<button class="ng-key" data-k="7">7</button>' +
        '<button class="ng-key" data-k="8">8</button>' +
        '<button class="ng-key" data-k="9">9</button>' +
        '<button class="ng-key ghost" data-k="clear">C</button>' +
        '<button class="ng-key" data-k="0">0</button>' +
        '<button class="ng-key ghost" data-k="del">&#9003;</button>' +
      '</div>' +
      '<div class="ng-foot">Interner Baustellen-Zugang. Bei Fragen: Victor Malt, STRABAG B8-13.</div>' +
    '</div>' +
    '<div class="ng-mtn"></div>';

  function mount() {
    gate.querySelector('h1').textContent = TITEL;      // via textContent (kein HTML-Inject)
    if (PORTAL) { (document.body || htmlEl).appendChild(gate); portal(); return; }
    gate.querySelector('.ng-sub').textContent = SUB;
    (document.body || htmlEl).appendChild(gate);
    wire();
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  var buffer = '';

  function wire() {
    var dots = gate.querySelectorAll('.ng-dot');
    var msg = gate.querySelector('#ngMsg');

    function render() {
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('on', i < buffer.length);
      }
    }

    function fail() {
      msg.textContent = 'Falscher Code';
      msg.classList.add('show');
      gate.classList.add('shake');
      setTimeout(function () { gate.classList.remove('shake'); }, 400);
      buffer = '';
      render();
      setTimeout(function () { msg.classList.remove('show'); }, 1200);
    }

    function unlock() {
      try { window.localStorage.setItem(KEY, '1'); } catch (e) { /* privater Modus: gilt nur diese Sitzung */ }
      gate.classList.add('ng-out');
      htmlEl.classList.remove('nalp-gate-locked');
      setTimeout(function () { if (gate.parentNode) gate.parentNode.removeChild(gate); }, 380);
      document.removeEventListener('keydown', onKey);
    }

    function push(d) {
      if (buffer.length >= MAXLEN) return;
      buffer += d;
      render();
      if (buffer.length === MAXLEN) {
        setTimeout(function () {
          if (buffer === CODE) unlock(); else fail();
        }, 130);
      }
    }

    gate.querySelector('#ngPad').addEventListener('click', function (e) {
      var btn = e.target.closest('.ng-key');
      if (!btn) return;
      var k = btn.getAttribute('data-k');
      if (k === 'del') { buffer = buffer.slice(0, -1); render(); }
      else if (k === 'clear') { buffer = ''; render(); }
      else push(k);
    });

    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') push(e.key);
      else if (e.key === 'Backspace') { buffer = buffer.slice(0, -1); render(); }
      else if (e.key === 'Escape') { buffer = ''; render(); }
    }
    document.addEventListener('keydown', onKey);

    render();
  }

  // ── Portal (05.11.2026): BuildTrack-Anmeldung statt Tastenfeld ──
  function freigeben() {          // dieselbe Mechanik wie unlock(), nur ohne localStorage-Flag
    gate.classList.add('ng-out');
    htmlEl.classList.remove('nalp-gate-locked');
    setTimeout(function () { if (gate.parentNode) gate.parentNode.removeChild(gate); }, 380);
  }

  // nalpBT bereitstellen: erst nach dem Parsen schauen (die Seite bindet nalp-buildtrack.js oft selbst weiter unten ein),
  // sonst per <script> nachladen — Pfad neben diesem Skript (alle Seiten liegen im Wurzelverzeichnis).
  function mitBT(weiter, fehlt) {
    function pruefen() {
      if (window.nalpBT && window.nalpBT.sitzung) { weiter(window.nalpBT); return; }
      var s = document.createElement('script');
      s.src = SELBST ? SELBST.replace(/nalp-gate\.js(\?.*)?$/, 'nalp-buildtrack.js') : 'assets/js/nalp-buildtrack.js';
      s.onload = function () { if (window.nalpBT && window.nalpBT.sitzung) weiter(window.nalpBT); else fehlt(); };
      s.onerror = fehlt;
      (document.head || htmlEl).appendChild(s);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pruefen);
    else pruefen();
  }

  function portal() {
    var f = gate.querySelector('#ngForm');
    var msg = gate.querySelector('#ngPMsg');
    var s1 = gate.querySelector('#ngSchritt1'), s2 = gate.querySelector('#ngSchritt2');
    var ok = gate.querySelector('#ngOk'), zurueck = gate.querySelector('#ngZurueck');
    var bt = null, challenge = null;

    function melden(t, info) { msg.textContent = t || ''; msg.classList.toggle('info', !!info); }
    function schritt(n) {
      s1.style.display = n === 1 ? '' : 'none';
      s2.style.display = n === 2 ? '' : 'none';
      ok.style.display = n ? '' : 'none';
      zurueck.style.display = n === 2 ? '' : 'none';
      ok.textContent = n === 2 ? 'Bestätigen' : 'Anmelden';
      setTimeout(function () { var i = n === 2 ? f.c : f.n; if (i) i.focus(); }, 30);
    }
    function antwort(r) {
      ok.disabled = false;
      if (r.ok) { freigeben(); return; }
      if (r.code) { challenge = r.challenge; f.c.value = ''; schritt(2); melden(r.msg, true); return; }
      melden(r.msg);
    }

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!bt) return;
      if (challenge) {
        if (!f.c.value.trim()) { melden('Bitte geben Sie den Code ein.'); return; }
        ok.disabled = true; melden('…', true);
        bt.codeBestaetigen(challenge, f.c.value, f.n.value).then(antwort);
        return;
      }
      if (!f.n.value.trim() || !f.p.value) { melden('Bitte geben Sie Name (oder E-Mail) und Passwort ein.'); return; }
      ok.disabled = true; melden('…', true);
      bt.anmelden(f.n.value, f.p.value).then(antwort);
    });
    zurueck.addEventListener('click', function () { challenge = null; f.p.value = ''; schritt(1); melden(''); });

    mitBT(function (nalpBT) {
      bt = nalpBT;
      bt.sitzung().then(function (konto) {
        if (konto) { freigeben(); return; }
        schritt(1);
        melden(bt.grund ? bt.grund() : '');
      });
    }, function () {
      melden('Die Anmeldung konnte nicht geladen werden – bitte mit Netz neu laden.');
    });
  }

  // Optionaler Logout von jeder Seite: window.nalpLogout()
  window.nalpLogout = function () {
    if (PORTAL) {                 // Portal: BuildTrack abmelden (Cookie bzw. Token), dann neu laden
      var fertig = function () { location.reload(); };
      if (window.nalpBT && window.nalpBT.abmelden) Promise.resolve(window.nalpBT.abmelden()).then(fertig, fertig);
      else fertig();
      return;
    }
    try { window.localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  };
})();
