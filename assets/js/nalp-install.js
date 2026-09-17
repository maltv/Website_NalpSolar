/*
 * nalp-install.js — "Willst du das als App speichern?"
 *
 * Auftrag Victor 08.09.2026: beim Aufmachen der Seite soll direkt gefragt
 * werden, ob sie als Webapp aufs Handy soll. Anlass war die Rueckfrage von
 * Schuoler, ob Sandro die Bestell-App auch als App hat oder ob jetzt alles
 * per Mail laeuft.
 *
 * Einbindung (nach nalp-gate.js, im <head>):
 *   <script src="assets/js/nalp-install.js"></script>
 *   <script>NalpInstall.start({name:'Transporte'});</script>
 *
 * WAS TECHNISCH GEHT — und was nicht:
 *  - Android (Chrome/Edge/Samsung): der Browser meldet sich mit dem Ereignis
 *    beforeinstallprompt. Wir fangen es ab und rufen es beim Antippen auf.
 *    Das ist der ECHTE Installationsdialog des Systems.
 *  - iPhone/iPad: es gibt dieses Ereignis NICHT. Apple laesst keine Webseite
 *    die Installation ausloesen. Dort bleibt nur die Anleitung "Teilen ->
 *    Zum Home-Bildschirm". Nicht versuchen, das zu umgehen - es existiert
 *    kein Weg, auch nicht ueber das Manifest.
 *  - Ist die Seite schon als App offen (display-mode: standalone), wird gar
 *    nichts gezeigt.
 *
 * VORAUSSETZUNG fuer das Ereignis: HTTPS, ein Manifest mit start_url und
 * display:standalone, ein Service Worker mit fetch-Handler und ein Icon von
 * mindestens 192 px. Fehlt das Icon, feuert beforeinstallprompt stillschweigend
 * nie - genau deshalb liegen seit 08.09.2026 ico-transporte-192.png und -512.png
 * im Manifest (das alte PNG hatte 180 px).
 *
 * NICHT NERVEN ist Teil der Aufgabe: wer "Spaeter" tippt, hat 14 Tage Ruhe;
 * nach dem dritten Mal wird nie wieder gefragt. Wer installiert, sieht es nie.
 */
(function (global) {
  'use strict';

  var LS = 'nalp_install_hinweis_v1';
  var RUHE_TAGE = 14;
  var MAX_ABLEHNUNGEN = 3;
  var WARTEN_MS = 1200;          // Seite zuerst aufbauen lassen
  var GATE_PRUEF_MS = 800;       // solange das Gate steht, wird nicht gefragt

  var ereignis = null;           // das aufgehobene beforeinstallprompt
  var gezeigt = false;
  var opt = {};

  // Das Ereignis kommt frueh - der Listener muss stehen, bevor irgendetwas
  // anderes laeuft. Darum ausserhalb von start().
  global.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();          // ohne das zeigt Chrome seine eigene Leiste
    ereignis = e;
    if (opt.aktiv) pruefen();
  });
  global.addEventListener('appinstalled', function () {
    merken({ nie: true });
    weg();
  });

  function stand() {
    try { return JSON.parse(global.localStorage.getItem(LS) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function merken(s) {
    try { global.localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { /* privat */ }
  }
  function alsAppOffen() {
    try {
      return (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches)
          || global.navigator.standalone === true;
    } catch (e) { return false; }
  }
  function apple() {
    var ua = global.navigator.userAgent || '';
    // iPadOS meldet sich seit 13 als Macintosh - erkennbar nur am Touch.
    return /iPhone|iPad|iPod/i.test(ua)
        || (/Macintosh/i.test(ua) && (global.navigator.maxTouchPoints || 0) > 1);
  }
  function gateOffen() {
    if (document.getElementById('nalpGate')) return false;
    var key = global.NALP_GATE_KEY;
    if (!key) return true;                       // Seite ohne Gate
    try { return global.localStorage.getItem(key) === '1'; } catch (e) { return true; }
  }

  function darfFragen() {
    if (gezeigt || alsAppOffen()) return false;
    var s = stand();
    if (s.nie) return false;
    if ((s.mal || 0) >= MAX_ABLEHNUNGEN) return false;
    if (s.bis && Date.now() < s.bis) return false;
    return apple() ? true : !!ereignis;          // Android erst mit Ereignis
  }

  function spaeter() {
    var s = stand();
    s.mal = (s.mal || 0) + 1;
    s.bis = Date.now() + RUHE_TAGE * 24 * 3600 * 1000;
    merken(s);
    weg();
  }
  function weg() {
    var e = document.getElementById('nalpInstall');
    if (e && e.parentNode) e.parentNode.removeChild(e);
  }

  function zeigen() {
    if (!darfFragen()) return;
    gezeigt = true;
    var ios = apple();
    var name = opt.name || 'Diese Seite';

    var css = document.createElement('style');
    css.textContent =
      '#nalpInstall{position:fixed;left:0;right:0;bottom:0;z-index:70;' +
        'font-family:Arial,"Helvetica Neue",sans-serif;color:#1a1a1a;' +
        'background:#fff;border-top:6px solid #D72622;border-radius:10px 10px 0 0;' +
        'box-shadow:0 -10px 34px rgba(10,15,22,.35);' +
        'padding:16px 16px calc(16px + env(safe-area-inset-bottom));' +
        'max-width:720px;margin:0 auto;animation:nalpInSlide .22s ease-out;}' +
      '@keyframes nalpInSlide{from{transform:translateY(100%)}to{transform:none}}' +
      '#nalpInstall .ni-kopf{display:flex;gap:11px;align-items:center;}' +
      '#nalpInstall img{width:44px;height:44px;border-radius:9px;flex:none;}' +
      '#nalpInstall .ni-tit{font-size:15.5px;font-weight:900;line-height:1.25;}' +
      '#nalpInstall .ni-txt{font-size:13px;color:#63676d;margin-top:9px;line-height:1.45;}' +
      '#nalpInstall .ni-akt{display:flex;gap:9px;margin-top:13px;}' +
      '#nalpInstall button{flex:1;font:inherit;font-size:14.5px;font-weight:800;' +
        'padding:12px 14px;border-radius:7px;border:1px solid #e3e5e8;background:#fff;' +
        'color:#1a1a1a;cursor:pointer;}' +
      '#nalpInstall button.ni-ja{background:#D72622;border-color:#D72622;color:#fff;}';
    document.head.appendChild(css);

    var box = document.createElement('div');
    box.id = 'nalpInstall';
    box.innerHTML =
      '<div class="ni-kopf">' +
        '<img src="' + (opt.icon || 'assets/img/ico-transporte-192.png') + '" alt="">' +
        '<div class="ni-tit">' + name + ' aufs Handy?</div>' +
      '</div>' +
      '<div class="ni-txt">' + (ios
        ? 'Unten auf das Teilen-Symbol tippen (Pfeil aus dem Kasten), dann ' +
          '<b>«Zum Home-Bildschirm»</b>. Danach startet ' + name + ' mit einem Tipp – ' +
          'ohne Browser, ohne Code.'
        : 'Als App auf dem Startbildschirm: ein Tipp und die Liste ist da – ' +
          'ohne Browser, ohne Code, auch bei schlechtem Empfang.') +
      '</div>' +
      '<div class="ni-akt">' +
        (ios ? '' : '<button class="ni-ja" id="niJa">Installieren</button>') +
        '<button id="niSpaeter">' + (ios ? 'Verstanden' : 'Später') + '</button>' +
      '</div>';
    document.body.appendChild(box);

    document.getElementById('niSpaeter').onclick = spaeter;
    var ja = document.getElementById('niJa');
    if (ja) ja.onclick = function () {
      var e = ereignis;
      ereignis = null;                    // das Ereignis gilt nur EINMAL
      weg();
      if (!e) return;
      e.prompt();
      e.userChoice.then(function (wahl) {
        if (wahl && wahl.outcome === 'accepted') merken({ nie: true });
        else spaeter();                   // im Systemdialog abgebrochen
      }).catch(function () { spaeter(); });
    };
  }

  function pruefen() {
    if (gezeigt || !darfFragen()) return;
    if (!gateOffen()) return;             // hinter dem Code-Gate nicht fragen
    if (document.body) zeigen();
  }

  function start(einstellungen) {
    opt = einstellungen || {};
    opt.aktiv = true;
    if (alsAppOffen()) return;            // laeuft schon als App
    var los = function () {
      global.setTimeout(function () {
        pruefen();
        // Das Gate kann noch offen sein (oder das Ereignis noch unterwegs) -
        // darum eine Weile nachfassen statt einmal zu schauen und aufzugeben.
        var versuche = 0;
        var takt = global.setInterval(function () {
          if (gezeigt || ++versuche > 45) { global.clearInterval(takt); return; }
          pruefen();
        }, GATE_PRUEF_MS);
      }, WARTEN_MS);
    };
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', los);
    else los();
  }

  global.NalpInstall = { start: start, zeigen: zeigen, weg: weg };
})(window);
