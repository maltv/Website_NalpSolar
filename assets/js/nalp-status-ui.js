/*
 * nalp-status-ui.js — Schaltflaeche „📊 Stand" + Slide-in-Panel „Stand der Dinge".
 * Liest NALP_STATUS (nalp-status.js) und rendert KPIs, offene Themen (mit Quelle)
 * und die Farb-Legende der Tisch-Kategorien. Wird von Karte (index.html) und
 * 3D-Viewer (viewer3d.html) geteilt. Muss NACH nalp-status.js geladen werden.
 */
(function () {
  'use strict';

  function init() {
    var S = window.NALP_STATUS;
    if (!S) { console.warn('[nalp-status-ui] NALP_STATUS fehlt'); return; }

    var css = '' +
      '#nsBtn{position:fixed;left:12px;bottom:12px;z-index:1600;border:none;border-radius:12px;' +
        'padding:10px 14px;font:700 13px/1 -apple-system,Arial,sans-serif;color:#fff;cursor:pointer;' +
        'background:linear-gradient(135deg,#0b5fff,#2196F3);box-shadow:0 3px 14px rgba(0,0,0,.4);' +
        'display:flex;align-items:center;gap:7px;-webkit-tap-highlight-color:transparent;}' +
      '#nsBtn .nsBadge{background:#e5484d;color:#fff;border-radius:999px;padding:1px 7px;font-size:11px;font-weight:800;}' +
      '#nsOv{position:fixed;inset:0;z-index:1700;background:rgba(4,10,18,.55);backdrop-filter:blur(2px);' +
        'opacity:0;pointer-events:none;transition:opacity .2s;}' +
      '#nsOv.on{opacity:1;pointer-events:auto;}' +
      '#nsPanel{position:fixed;top:0;right:0;bottom:0;z-index:1800;width:min(430px,92vw);' +
        'transform:translateX(102%);transition:transform .28s cubic-bezier(.4,0,.2,1);' +
        'background:#0e1826;color:#e8eef7;box-shadow:-8px 0 40px rgba(0,0,0,.5);' +
        'display:flex;flex-direction:column;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;}' +
      '#nsPanel.on{transform:translateX(0);}' +
      '#nsPanel .ns-head{padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.08);' +
        'background:radial-gradient(120% 100% at 100% 0,#173657,#0e1826);}' +
      '#nsPanel .ns-brand{font-size:11px;letter-spacing:.22em;font-weight:800;color:#ffc340;text-transform:uppercase;}' +
      '#nsPanel h2{margin:3px 0 2px;font-size:20px;font-weight:900;}' +
      '#nsPanel .ns-stand{font-size:12px;color:rgba(232,238,247,.6);}' +
      '#nsPanel .ns-x{position:absolute;top:12px;right:14px;background:rgba(255,255,255,.1);border:none;' +
        'color:#fff;width:32px;height:32px;border-radius:50%;font-size:19px;cursor:pointer;line-height:1;}' +
      '#nsPanel .ns-body{overflow-y:auto;padding:14px 16px 30px;-webkit-overflow-scrolling:touch;}' +
      '#nsPanel .ns-kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px;}' +
      '#nsPanel .ns-kpi{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);' +
        'border-radius:11px;padding:10px 11px;}' +
      '#nsPanel .ns-kpi .v{font-size:22px;font-weight:900;line-height:1;}' +
      '#nsPanel .ns-kpi .v small{font-size:11px;font-weight:700;color:rgba(232,238,247,.55);margin-left:3px;}' +
      '#nsPanel .ns-kpi .l{font-size:11px;font-weight:700;margin-top:5px;color:rgba(232,238,247,.8);}' +
      '#nsPanel .ns-kpi .q{font-size:9.5px;color:rgba(232,238,247,.4);margin-top:4px;line-height:1.35;}' +
      '#nsPanel .ns-kpi.rot .v{color:#ff6b6b;} #nsPanel .ns-kpi.orange .v{color:#ffb347;}' +
      '#nsPanel .ns-sec{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;' +
        'color:rgba(232,238,247,.55);margin:6px 0 9px;}' +
      '#nsPanel .ns-item{position:relative;background:rgba(255,255,255,.04);border-radius:11px;' +
        'padding:11px 12px 11px 15px;margin-bottom:9px;overflow:hidden;}' +
      '#nsPanel .ns-item::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--sc,#888);}' +
      '#nsPanel .ns-it-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;}' +
      '#nsPanel .ns-it-title{font-size:14px;font-weight:800;}' +
      '#nsPanel .ns-it-date{font-size:10.5px;color:rgba(232,238,247,.5);white-space:nowrap;}' +
      '#nsPanel .ns-it-text{font-size:12.5px;line-height:1.5;color:rgba(232,238,247,.82);margin:5px 0 6px;}' +
      '#nsPanel .ns-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;}' +
      '#nsPanel .ns-chip{font-size:10px;font-weight:700;background:rgba(255,255,255,.09);border-radius:6px;' +
        'padding:2px 6px;cursor:pointer;color:#dbe6f5;}' +
      '#nsPanel .ns-chip:hover{background:#0b5fff;}' +
      '#nsPanel .ns-q{font-size:10px;color:rgba(232,238,247,.42);line-height:1.4;}' +
      '#nsPanel .ns-q b{color:rgba(232,238,247,.6);font-weight:700;}' +
      '#nsPanel .ns-leg{display:grid;grid-template-columns:1fr;gap:6px;margin:4px 0 16px;}' +
      '#nsPanel .ns-leg-row{display:flex;align-items:flex-start;gap:9px;font-size:11.5px;line-height:1.4;}' +
      '#nsPanel .ns-sw{width:14px;height:14px;border-radius:4px;flex:none;margin-top:1px;}' +
      '#nsPanel .ns-leg-row b{color:#e8eef7;}' +
      '#nsPanel .ns-legnote{font-size:10.5px;color:rgba(232,238,247,.5);line-height:1.5;' +
        'background:rgba(255,255,255,.04);border-radius:8px;padding:8px 10px;margin:2px 0 14px;}' +
      '#nsPanel .ns-legnote b{color:rgba(232,238,247,.75);}' +
      '#nsPanel .ns-foot{font-size:10.5px;color:rgba(232,238,247,.4);border-top:1px solid rgba(255,255,255,.08);' +
        'padding-top:10px;margin-top:8px;line-height:1.5;}';

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // Anzahl akuter Themen fuers Badge
    var akut = S.themen.filter(function (t) { return t.schwere === 'stopp' || t.schwere === 'hoch'; }).length;

    var btn = document.createElement('button');
    btn.id = 'nsBtn';
    btn.innerHTML = '📊 Stand' + (akut ? ' <span class="nsBadge">' + akut + '</span>' : '');
    document.body.appendChild(btn);

    var ov = document.createElement('div');
    ov.id = 'nsOv';
    document.body.appendChild(ov);

    var panel = document.createElement('div');
    panel.id = 'nsPanel';
    panel.innerHTML = buildPanelHtml(S);
    document.body.appendChild(panel);

    function open() { ov.classList.add('on'); panel.classList.add('on'); }
    function close() { ov.classList.remove('on'); panel.classList.remove('on'); }
    btn.addEventListener('click', open);
    ov.addEventListener('click', close);
    panel.querySelector('.ns-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    // Tisch-Chip klick -> optionaler Hook (Karte/3D koennen window.nalpFocusTisch setzen)
    panel.addEventListener('click', function (e) {
      var chip = e.target.closest('.ns-chip[data-id]');
      if (!chip) return;
      var id = chip.getAttribute('data-id');
      if (typeof window.nalpFocusTisch === 'function') { close(); window.nalpFocusTisch(id); }
    });

    window.nalpOpenStatus = open;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function buildPanelHtml(S) {
    var kpis = S.kpis.map(function (k) {
      return '<div class="ns-kpi ' + (k.ton || '') + '">' +
        '<div class="v">' + esc(k.wert) + (k.einheit ? '<small>' + esc(k.einheit) + '</small>' : '') + '</div>' +
        '<div class="l">' + esc(k.label) + '</div>' +
        '<div class="q">' + esc(k.quelle) + '</div>' +
      '</div>';
    }).join('');

    var themen = S.themen.map(function (t) {
      var sc = ({ stopp: '#e5484d', hoch: '#ff8a3d', mittel: '#ffd23f', info: '#4a86c5' })[t.schwere] || '#888';
      var chips = (t.tische || []).map(function (id) {
        return '<span class="ns-chip" data-id="' + id + '">' + id + '</span>';
      }).join('');
      return '<div class="ns-item" style="--sc:' + sc + '">' +
        '<div class="ns-it-top"><div class="ns-it-title">' + (t.icon || '') + ' ' + esc(t.titel) + '</div>' +
          '<div class="ns-it-date">' + esc(t.datum || '') + '</div></div>' +
        '<div class="ns-it-text">' + esc(t.text) + '</div>' +
        (chips ? '<div class="ns-chips">' + chips + '</div>' : '') +
        '<div class="ns-q"><b>Quelle:</b> ' + esc(t.quelle) + '</div>' +
      '</div>';
    }).join('');

    var leg = Object.keys(S.kategorien).map(function (key) {
      var c = S.kategorien[key];
      return '<div class="ns-leg-row"><span class="ns-sw" style="background:' + c.color + '"></span>' +
        '<div><b>' + c.icon + ' ' + esc(c.label) + '</b><br>' + esc(c.kurz) + '</div></div>';
    }).join('');

    return '' +
      '<div class="ns-head">' +
        '<button class="ns-x" title="Schliessen">&times;</button>' +
        '<div class="ns-brand">NalpSolar &middot; STRABAG B8-13</div>' +
        '<h2>Stand der Dinge</h2>' +
        '<div class="ns-stand">Arbeitsstand ' + esc(S.standLabel) + '</div>' +
      '</div>' +
      '<div class="ns-body">' +
        '<div class="ns-kpis">' + kpis + '</div>' +
        '<div class="ns-sec">Offene Themen &amp; Probleme</div>' + themen +
        '<div class="ns-sec">Farb-Legende Tische (3D / Karte)</div>' +
        '<div class="ns-leg">' + leg + '</div>' +
        '<div class="ns-legnote">Jeder Problem-Tisch ist farblich markiert – auf der <b>2D-Karte</b> als Ring, ' +
          'im <b>3D-Modell</b> als eingefärbter Tisch (klick-/suchbar). ' +
          'Für 2 Tische (390, 2178) fehlen Koordinaten in den Kartendaten – sie stehen nur oben im Text.</div>' +
        '<div class="ns-foot">' + esc(S.hinweis) + '</div>' +
      '</div>';
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
