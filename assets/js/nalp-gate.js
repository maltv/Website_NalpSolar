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
 */
(function () {
  'use strict';

  var CODE = String(window.NALP_GATE_CODE || '6460');            // Zugangscode
  var KEY  = String(window.NALP_GATE_KEY  || 'nalp_portal_unlock_v1');  // localStorage-Flag
  var TITEL = String(window.NALP_GATE_TITEL || 'Baustellen-Portal');
  var SUB   = String(window.NALP_GATE_SUB   || 'Code eingeben, um fortzufahren');
  var MAXLEN = CODE.length;

  // Bereits freigeschaltet? -> nichts tun.
  try { if (window.localStorage.getItem(KEY) === '1') return; } catch (e) { /* privater Modus */ }

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

  var style = document.createElement('style');
  style.textContent = css;
  (document.head || htmlEl).appendChild(style);

  var gate = document.createElement('div');
  gate.id = 'nalpGate';
  gate.innerHTML =
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

  // Optionaler Logout von jeder Seite: window.nalpLogout()
  window.nalpLogout = function () {
    try { window.localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  };
})();
