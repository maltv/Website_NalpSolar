/*
 * nalp-gate.js — Zugangs-Gate fuer das NalpSolar Baustellen-Portal.
 *
 * ACHTUNG: Client-seitiges "Soft-Gate". Haelt normale Besucher mit dem Code
 * fern, ist aber KEIN echter Schutz (Code steht im Quelltext). Fuer echten
 * Schutz waere Firebase-Auth / Server-Passwort noetig.
 *
 * Einbindung: <script src="assets/js/nalp-gate.js"></script> im <head> JEDER
 * oeffentlichen Seite, moeglichst frueh (vor den grossen App-Skripten).
 */
(function () {
  'use strict';

  var CODE = '6460';                    // Zugangscode
  var KEY = 'nalp_portal_unlock_v1';    // localStorage-Flag (bleibt bis Logout/Cache-Leerung)
  var MAXLEN = CODE.length;

  // Bereits freigeschaltet? -> nichts tun.
  try { if (window.localStorage.getItem(KEY) === '1') return; } catch (e) { /* privater Modus */ }

  // Scroll/Interaktion sperren bis freigeschaltet.
  var htmlEl = document.documentElement;
  htmlEl.classList.add('nalp-gate-locked');

  var css = '' +
    '.nalp-gate-locked{overflow:hidden !important;}' +
    '#nalpGate{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;padding:24px;box-sizing:border-box;' +
      'font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#e8eef7;' +
      'background:radial-gradient(120% 90% at 50% -10%,#12304f 0%,#0b1826 55%,#070d15 100%);' +
      '-webkit-tap-highlight-color:transparent;user-select:none;}' +
    '#nalpGate .ng-sun{position:absolute;top:-90px;left:50%;transform:translateX(-50%);' +
      'width:340px;height:340px;border-radius:50%;filter:blur(2px);opacity:.55;' +
      'background:radial-gradient(circle,rgba(255,196,64,.9) 0%,rgba(255,150,32,.25) 45%,transparent 70%);}' +
    '#nalpGate .ng-mtn{position:absolute;bottom:0;left:0;right:0;height:32vh;min-height:150px;' +
      'background:linear-gradient(180deg,transparent,rgba(10,20,32,.85));' +
      'clip-path:polygon(0 62%,14% 40%,26% 55%,40% 24%,54% 50%,66% 30%,80% 52%,92% 36%,100% 58%,100% 100%,0 100%);' +
      'opacity:.5;pointer-events:none;}' +
    '#nalpGate .ng-card{position:relative;z-index:2;width:100%;max-width:320px;text-align:center;}' +
    '#nalpGate .ng-brand{font-size:13px;letter-spacing:.28em;font-weight:800;' +
      'color:#ffc340;text-transform:uppercase;margin-bottom:6px;}' +
    '#nalpGate h1{font-size:26px;font-weight:900;margin:0 0 4px;letter-spacing:.01em;}' +
    '#nalpGate .ng-sub{font-size:13px;color:rgba(232,238,247,.6);margin-bottom:26px;}' +
    '#nalpGate .ng-dots{display:flex;gap:16px;justify-content:center;margin-bottom:8px;height:20px;}' +
    '#nalpGate .ng-dot{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.35);' +
      'transition:transform .12s,background .12s,border-color .12s;}' +
    '#nalpGate .ng-dot.on{background:#2196F3;border-color:#57b0ff;transform:scale(1.12);}' +
    '#nalpGate .ng-msg{height:20px;font-size:13px;font-weight:700;color:#ff6b6b;margin-bottom:14px;opacity:0;transition:opacity .15s;}' +
    '#nalpGate .ng-msg.show{opacity:1;}' +
    '#nalpGate.shake .ng-dots{animation:ngShake .38s;}' +
    '@keyframes ngShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(9px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}' +
    '#nalpGate .ng-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:280px;margin:0 auto;}' +
    '#nalpGate .ng-key{aspect-ratio:1/1;border:none;border-radius:50%;font-size:26px;font-weight:700;' +
      'color:#e8eef7;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);' +
      'cursor:pointer;touch-action:manipulation;transition:background .12s,transform .06s;}' +
    '#nalpGate .ng-key:active{background:rgba(33,150,243,.4);transform:scale(.94);}' +
    '#nalpGate .ng-key.ghost{background:none;box-shadow:none;font-size:15px;font-weight:600;color:rgba(232,238,247,.55);}' +
    '#nalpGate .ng-foot{margin-top:26px;font-size:11px;color:rgba(232,238,247,.4);line-height:1.5;}' +
    '#nalpGate.ng-out{opacity:0;transform:scale(1.04);transition:opacity .35s,transform .35s;pointer-events:none;}';

  var style = document.createElement('style');
  style.textContent = css;
  (document.head || htmlEl).appendChild(style);

  var gate = document.createElement('div');
  gate.id = 'nalpGate';
  gate.innerHTML =
    '<div class="ng-sun"></div>' +
    '<div class="ng-card">' +
      '<div class="ng-brand">NalpSolar &middot; STRABAG</div>' +
      '<h1>Baustellen-Portal</h1>' +
      '<div class="ng-sub">Code eingeben, um fortzufahren</div>' +
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
