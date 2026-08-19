/* ═══════════════════════════════════════════════════════════════════
   Pfahlüberstand über Urgelände - gemeinsamer Baustein
   ═══════════════════════════════════════════════════════════════════
   Zeigt, welche Pfähle mehr als die zulässigen 15 cm aus dem Urgelände
   ragen - Grundlage für das Eindecken. Daten aus
   uploads/pfahlueberstand.json, erzeugt von Tools\Pfahlueberstand_Bauen.py.

   Wird von ZWEI Stellen benutzt und liegt darum hier und nicht in einer
   der beiden Seiten:
     admin.html            Reiter «Überstand»
     pfahlueberstand.html  eigenstaendige Seite (direkt aufrufbar)
   Beide rufen NalpUeberstand.start(wurzelElement). Markup und CSS bringt
   der Baustein selbst mit, die Seiten stellen nur einen leeren DIV.

   Kartenmuster (Canvas + SWISSIMAGE-Kacheln, Antippen statt GPS) wie in
   pfahlkopf.html - GPS ist für die Wahl des Einzelpfahls zu ungenau.
   ═══════════════════════════════════════════════════════════════════ */
window.NalpUeberstand = (function () {
  'use strict';

  var CSS = [
    '.ueb-zahlen{display:flex;gap:8px;margin:0 0 12px;flex-wrap:wrap}',
    '.ueb-kachel{flex:1 1 90px;background:#f6f7f9;border:1px solid #e3e5e8;border-radius:9px;padding:7px 9px}',
    '.ueb-kachel b{display:block;font-size:19px;line-height:1.1}',
    '.ueb-kachel span{font-size:11px;color:#63676d}',
    '.ueb-kachel.warn b{color:#D72622}',
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
    '.ueb-gp b{font-variant-numeric:tabular-nums}',
    '.ueb-marke{font-size:10.5px;padding:1px 6px;border-radius:10px;border:1px solid #e3e5e8;',
    '  color:#63676d;white-space:nowrap}',
    '.ueb-marke.grob{background:#fff3f3;border-color:#f2c9c9;color:#a33}',
    '.ueb-marke.mittel{background:#fffaed;border-color:#ecd9a4;color:#7a5f10}',
    '.ueb-quellen{font-size:11.5px;color:#63676d;line-height:1.55;margin-top:18px;',
    '  border-top:1px solid #e3e5e8;padding-top:12px}',
    '.ueb-quellen b{color:#1a1a1a}',
    '.ueb-laden{padding:40px 0;text-align:center;color:#63676d}'
  ].join('\n');

  var MARKUP = [
    '<div class="ueb-laden" id="uebLaden">Daten werden geladen …</div>',
    '<div id="uebInhalt" style="display:none">',
    '  <div class="ueb-zahlen" id="uebZahlen"></div>',
    '  <div class="ueb-box"><canvas id="uebKarte"></canvas>',
    '    <div class="ueb-info" id="uebInfo"></div></div>',
    '  <div class="ueb-werkzeug">',
    '    <button class="ueb-sw on" id="uebFRot">Nur zu hoch</button>',
    '    <button class="ueb-sw" id="uebFSicher">Nur zu hoch &amp; sicher</button>',
    '    <button class="ueb-sw" id="uebFAlle">Alle Pfähle</button>',
    '    <button class="ueb-sw on" id="uebSwSat">Satellit</button>',
    '    <button class="ueb-sw" id="uebSwIds">Nummern</button>',
    '    <button class="ueb-sw" id="uebGanz">Ganze Baustelle</button>',
    '  </div>',
    '  <div class="ueb-legende">',
    '    <span><i style="background:#8c1512"></i>über 50 cm</span>',
    '    <span><i style="background:#D72622"></i>30–50 cm</span>',
    '    <span><i style="background:#f08c00"></i>15–30 cm</span>',
    '    <span><i style="background:#1e9e5a"></i>im Rahmen (≤ 15 cm)</span>',
    '    <span><i style="background:#fff;border:2px solid #D72622"></i>hohl = Geländehöhe grob,',
    '      vor dem Eindecken nachmessen</span>',
    '  </div>',
    '  <div class="ueb-detail" id="uebDetail"><h3>Pfahl antippen</h3></div>',
    '  <h3 style="font-size:15px;margin:22px 0 4px">Arbeitsliste nach Bereich</h3>',
    '  <div style="font-size:12px;color:#63676d;margin-bottom:8px">Nur Pfähle über der',
    '    Schwelle. Antippen springt auf die Karte.</div>',
    '  <div id="uebListe"></div>',
    '  <div class="ueb-quellen" id="uebQuellen"></div>',
    '</div>'
  ].join('\n');

  var DATEN = null, pfaehle = [], sel = null, filter = 'rot';
  var zeigeSat = true, zeigeIds = false;
  var ORIGIN = null, view = { cx: 0, cy: 0, mpp: 1.2 };
  var cv, ctx, dpr = 1, gestartet = false, wurzel = null;
  function $(i) { return document.getElementById(i); }

  /* ─────────── Farbe und Grösse nach Überstand ─────────── */
  function stufe(u) {
    if (u > 0.50) return { f: '#8c1512', r: 5.5, t: 'über 50 cm' };
    if (u > 0.30) return { f: '#D72622', r: 4.6, t: '30–50 cm' };
    if (u > 0.15) return { f: '#f08c00', r: 3.8, t: '15–30 cm' };
    return { f: '#1e9e5a', r: 2.6, t: 'im Rahmen' };
  }
  function cm(u) { return (u >= 0 ? '+' : '−') + Math.abs(Math.round(u * 100)) + ' cm'; }

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
    if (filter === 'sicher') return p.ampel === 'rot' && p.guete === 'hoch';
    return p.ampel === 'rot';
  }
  function malen() {
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    if (!r.width) return;                                 // Reiter noch verborgen
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, r.width, r.height);
    satMalen(r);

    var gezeichnet = 0;
    /* grüne zuerst, damit die roten oben liegen */
    var sortiert = pfaehle.slice().sort(function (a, b) { return a.ueb - b.ueb; });
    for (var i = 0; i < sortiert.length; i++) {
      var p = sortiert[i]; if (!sichtbar(p)) continue;
      var q = s2p(p);
      if (q.x < -20 || q.y < -20 || q.x > r.width + 20 || q.y > r.height + 20) continue;
      gezeichnet++;
      var st = stufe(p.ueb);
      var rad = Math.max(2.2, Math.min(st.r * 2.4, st.r / Math.max(view.mpp, 0.06) * 0.55));
      ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, 6.2832);
      if (p.guete === 'hoch') {
        ctx.fillStyle = st.f; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke();
      } else {
        /* hohl = Geländehöhe nur grob bekannt, im Feld nachmessen */
        ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
        ctx.lineWidth = Math.max(1.6, rad * 0.45); ctx.strokeStyle = st.f; ctx.stroke();
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
    $('uebFRot').classList.toggle('on', f === 'rot');
    $('uebFSicher').classList.toggle('on', f === 'sicher');
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
    var st = stufe(p.ueb);
    var h = '<h3>' + p.tisch + ' · ' + p.stelle
          + ' <span style="color:' + st.f + '">' + cm(p.ueb) + '</span></h3>';
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
    h += z('Bereich · Typ', p.bereich + ' · ' + p.typ);
    h += z('Stand Nalpi', p.status || '–');
    h += z('gebohrt', p.bohr || '–');
    if (p.guete !== 'hoch') {
      h += '<div class="ueb-hinweis"><b>Vor dem Eindecken nachmessen.</b> '
         + (p.warn || 'Geländehöhe nur grob bekannt.') + '</div>';
    }
    if (p.ueb > 1.0) {
      h += '<div class="ueb-hinweis"><b>Mehr als 1 m – das ist kein Eindecken mehr.</b> '
         + 'Hier steht eine Geländeanpassung oder eine planerische Klärung an.</div>';
    }
    $('uebDetail').innerHTML = h;
  }

  /* ─────────── Arbeitsliste nach Bereich ─────────── */
  function listeMalen() {
    var rot = pfaehle.filter(function (p) { return p.ampel === 'rot'; });
    var g = {};
    rot.forEach(function (p) { (g[p.bereich] = g[p.bereich] || []).push(p); });
    var namen = Object.keys(g).sort(function (a, b) { return g[b].length - g[a].length; });
    var h = '';
    namen.forEach(function (n, i) {
      var v = g[n].slice().sort(function (a, b) { return b.ueb - a.ueb; });
      var sicher = v.filter(function (p) { return p.guete === 'hoch'; }).length;
      var tische = Object.keys(v.reduce(function (a, p) { a[p.tisch] = 1; return a; }, {})).length;
      h += '<div class="ueb-gruppe"><button class="ueb-gkopf" data-gruppe="' + i + '">'
         + '<span>' + (n === '?' ? 'ohne Bereichszuordnung' : n) + '<br>'
         + '<small>' + v.length + ' Pfähle · ' + tische + ' Tische · ' + sicher + ' sicher</small></span>'
         + '<span style="color:#63676d;font-size:12px">▾</span></button>'
         + '<div class="ueb-gliste" id="uebGl' + i + '">';
      v.forEach(function (p) {
        var st = stufe(p.ueb);
        h += '<div class="ueb-gp" data-pfahl="' + p.id + '">'
           + '<span>' + p.tisch + ' · ' + p.stelle
           + (p.guete === 'hoch' ? '' : ' <span class="ueb-marke ' + p.guete + '">nachmessen</span>')
           + '</span><b style="color:' + st.f + '">' + cm(p.ueb) + '</b></div>';
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
    if (filter === 'sicher' && p.guete !== 'hoch') filterSetzen('rot');
    sel = p; springen(p.x, p.y, Math.min(view.mpp, 0.25)); detailMalen();
    wurzel.querySelector('.ueb-box').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ─────────── Kopfzahlen und Quellen ─────────── */
  function kachelHtml(n, t, k) {
    return '<div class="ueb-kachel ' + k + '"><b>' + n + '</b><span>' + t + '</span></div>';
  }
  function kopfMalen() {
    var s = DATEN.zusammenfassung;
    $('uebZahlen').innerHTML =
      kachelHtml(s.rot, 'zu hoch', 'warn')
      + kachelHtml(s.rot_hoch, 'davon sicher', '')
      + kachelHtml(s.rot_mittel + s.rot_grob, 'davon nachmessen', '')
      + kachelHtml(s.gruen, 'im Rahmen', '');
  }
  function quellenMalen() {
    var q = DATEN.quellen, s = DATEN.zusammenfassung;
    $('uebQuellen').innerHTML =
      'Stand ' + DATEN.stand + ' · Schwelle ' + Math.round(DATEN.schwelle * 100) + ' cm · '
      + s.bewertet + ' eingemessene Pfähle<br><br>'
      + '<b>Vorgabe</b><br>' + q.vorgabe + '<br><br>'
      + '<b>Pfahlhöhe</b><br>' + q.ist + '<br><br>'
      + '<b>Urgelände</b><br>1. ' + q.mai + '<br>2. ' + q.sep + '<br>3. ' + q.alti + '<br><br>'
      + '<b>Wie die Geländequelle gewählt wird</b><br>' + DATEN.regel + '<br><br>'
      + 'Verwendet: ' + s.mai + ' Pfähle aus dem Maiflug, ' + s.sep
      + ' aus dem Septemberflug, ' + s.alti + ' aus swissALTI3D.<br>'
      + 'Erzeugt von <code>Tools\\Pfahlueberstand_Bauen.py</code>, Stand ' + DATEN.stand + '.';
  }

  /* ─────────── Start ─────────── */
  function aufbauen() {
    cv = $('uebKarte'); ctx = cv.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    $('uebFRot').onclick = function () { filterSetzen('rot'); };
    $('uebFSicher').onclick = function () { filterSetzen('sicher'); };
    $('uebFAlle').onclick = function () { filterSetzen('alle'); };
    $('uebSwSat').onclick = function () { schalter('sat'); };
    $('uebSwIds').onclick = function () { schalter('ids'); };
    $('uebGanz').onclick = ganzeBaustelle;
    kartenEvents();
    ganzeBaustelle();
  }

  function start(el) {
    /* Mehrfachaufruf ist erlaubt: der Admin ruft start() bei jedem Reiterwechsel,
       damit die Karte nach dem Einblenden ihre echte Breite bekommt. */
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
        $('uebLaden').style.display = 'none';
        $('uebInhalt').style.display = '';
        gestartet = true;
        kopfMalen(); quellenMalen(); listeMalen(); aufbauen();
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
                      stufe: stufe, cm: cm, sichtbar: sichtbar, filterSetzen: filterSetzen,
                      detailMalen: detailMalen, listeMalen: listeMalen,
                      ganzeBaustelle: ganzeBaustelle, zuPfahl: zuPfahl };
           } };
})();
