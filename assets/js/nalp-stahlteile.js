/*
 * nalp-stahlteile.js — herumliegende Stahlteile im Perimeter per GPS erfassen.
 *
 * Zweck: Beim Ablaufen des Perimeters festhalten, WO eine vormontierte
 * Primärkonstruktion (mit Tisch-ID) oder ein loses Stahlteil liegt.
 * Die Einträge werden auf der 2D-Karte (karte.html) und im 3D-Viewer
 * (viewer3d.html) als Marker am erfassten GPS-Standort angezeigt und
 * können dort per Antippen wieder gelöscht werden (aufgeräumt/verbaut).
 *
 * Speicher: Firebase Realtime Database (anmeldefrei, REST) unter
 *   erfassung/stahlteile/<key>  +  localStorage-Spiegel (offline-sicher).
 * Datensatz: { art:'primaer'|'teil', teilTyp, tischId, anzahl, bemerkung,
 *              von, datum, lat, lon, acc, ts }
 *
 * Einbindung: <script src="assets/js/nalp-stahlteile.js"></script>
 *   window.nalpStahlteileOpen()            – Erfassungs-Panel öffnen
 *   NalpStahlteile.subscribe(fn)           – fn(items) nach jedem Laden/Ändern
 *   NalpStahlteile.refresh()               – neu laden + Subscriber informieren
 *   NalpStahlteile.remove(item, cb)        – Eintrag löschen (cb(ok, msg))
 *
 * Teil-Katalog gemäss Montagekonzept NalpSolar_51_BE_0300 Rev A4 /
 * Primärkonstruktions-Plänen (siehe stahlbau.html).
 */
(function () {
  'use strict';

  var DB = 'https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app';
  var PATH = 'erfassung/stahlteile';
  var LS_LOG = 'nalp_stahlteile_v1';      // lokaler Spiegel
  var LS_VON = 'nalp_erfasser_v1';        // gleicher "Erfasst von" wie nalp-erfassung.js

  // Stahlbauteile Primärkonstruktion (Begriffe aus Montagekonzept/Plänen)
  var TEILE = [
    'Stütze',
    'Auflagerträger',
    'Modulträger (Pfette)',
    'Aussteifung / Riegel',
    'Passstück',
    'Modulklemmen',
    'Schrauben / Kleinmaterial',
    'Sonstiges Stahlteil'
  ];

  var current = 'primaer';
  var subscribers = [];
  var gpsWatch = null, lastFix = null;

  /* ---------- Helpers ---------- */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function todayISO(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function fmtDate(iso){ if(!iso) return ''; var p=String(iso).split('-'); return p.length===3 ? p[2]+'.'+p[1]+'.'+p[0] : iso; }

  function lsLoad(){ try{ return JSON.parse(localStorage.getItem(LS_LOG)||'[]'); }catch(e){ return []; } }
  function lsSave(arr){ try{ localStorage.setItem(LS_LOG, JSON.stringify(arr.slice(-300))); }catch(e){} }
  function getVon(){ try{ return localStorage.getItem(LS_VON)||''; }catch(e){ return ''; } }
  function setVon(v){ try{ localStorage.setItem(LS_VON, v||''); }catch(e){} }

  function stripLocal(rec){ var c={}; Object.keys(rec).forEach(function(k){ if(k!=='fb'&&k!=='key') c[k]=rec[k]; }); return c; }

  function fbPush(rec){
    return fetch(DB+'/'+PATH+'.json', { method:'POST', body: JSON.stringify(stripLocal(rec)) })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ return j && j.name ? j.name : null; })
      .catch(function(){ return null; });
  }
  function fbDelete(key){
    return fetch(DB+'/'+PATH+'/'+encodeURIComponent(key)+'.json', { method:'DELETE' })
      .then(function(r){ return r.ok; }).catch(function(){ return false; });
  }
  function fbList(){
    return fetch(DB+'/'+PATH+'.json', { cache:'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; });
  }

  /* ---------- Datenzugriff ---------- */
  // Merge Firebase + lokale (noch nicht synchronisierte) Einträge
  function loadAll(cb){
    fbList().then(function(remote){
      var items = [];
      var remoteTs = {};
      if (remote) {
        Object.keys(remote).forEach(function(k){
          var r = remote[k]; if(!r) return;
          r.key = k; r.fb = true;
          remoteTs[r.ts] = true;
          items.push(r);
        });
      }
      lsLoad().forEach(function(r){
        if (r.fb === true) return;               // ist (oder war) in Firebase
        if (r.ts != null && remoteTs[r.ts]) return;
        r.key = null;
        items.push(r);
      });
      items.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
      cb(items, remote !== null);
    });
  }

  function notify(){
    loadAll(function(items){
      subscribers.forEach(function(fn){ try{ fn(items); }catch(e){ console.warn('[nalp-stahlteile] subscriber', e); } });
      if (panel && panel.classList.contains('on')) renderList(items);
    });
  }

  // pending (offline erfasste) Einträge erneut hochladen
  function flushPending(){
    var log = lsLoad();
    var pend = log.filter(function(r){ return r.fb !== true; });
    if (!pend.length) return;
    pend.forEach(function(r){
      fbPush(r).then(function(key){
        if (!key) return;
        var l = lsLoad();
        var i = l.map(function(x){ return x.ts; }).indexOf(r.ts);
        if (i >= 0) { l[i].fb = true; l[i].key = key; lsSave(l); notify(); }
        else fbDelete(key).then(notify);   // wurde während des Uploads gelöscht -> nicht auferstehen lassen
      });
    });
  }

  function removeItem(item, cb){
    cb = cb || function(){};
    function dropLocal(){
      var l = lsLoad().filter(function(r){ return r.ts !== item.ts; });
      lsSave(l);
    }
    if (item.key) {
      fbDelete(item.key).then(function(ok){
        if (ok) { dropLocal(); notify(); cb(true); }
        else cb(false, 'Firebase nicht erreichbar – Löschen ist nur online möglich.');
      });
    } else {
      dropLocal(); notify(); cb(true);
    }
  }

  /* ---------- GPS ---------- */
  function gpsStart(){
    if (gpsWatch != null || !navigator.geolocation) return;
    gpsWatch = navigator.geolocation.watchPosition(
      function(p){
        lastFix = { lat:p.coords.latitude, lon:p.coords.longitude, acc:p.coords.accuracy, t:Date.now() };
        paintGps();
      },
      function(e){ lastFix = null; paintGps(e.message); },
      { enableHighAccuracy:true, timeout:30000, maximumAge:2000 }
    );
  }
  function gpsStop(){
    if (gpsWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatch);
    gpsWatch = null;
  }
  function paintGps(errMsg){
    var el = panel && panel.querySelector('#stGps');
    if (!el) return;
    if (errMsg) { el.innerHTML = '📡 GPS-Fehler: '+esc(errMsg); el.className='st-gps bad'; return; }
    if (!lastFix) { el.innerHTML = '📡 GPS: warte auf Position …'; el.className='st-gps'; return; }
    var a = Math.round(lastFix.acc);
    el.innerHTML = '📍 GPS ±'+a+' m &nbsp;<small>'+lastFix.lat.toFixed(5)+'°N '+lastFix.lon.toFixed(5)+'°E</small>';
    el.className = 'st-gps ' + (a <= 15 ? 'ok' : 'warn');
  }

  /* ---------- UI ---------- */
  function css(){
    return '' +
    '#stOv{position:fixed;inset:0;z-index:12000;background:rgba(4,10,18,.55);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .2s;}' +
    '#stOv.on{opacity:1;pointer-events:auto;}' +
    '#stPanel{position:fixed;top:0;right:0;bottom:0;z-index:12001;width:min(440px,94vw);transform:translateX(103%);' +
      'transition:transform .28s cubic-bezier(.4,0,.2,1);background:#0e1826;color:#e8eef7;box-shadow:-8px 0 40px rgba(0,0,0,.5);' +
      'display:flex;flex-direction:column;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;}' +
    '#stPanel.on{transform:translateX(0);}' +
    '#stPanel .st-head{padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.08);background:radial-gradient(120% 100% at 100% 0,#173657,#0e1826);position:relative;}' +
    '#stPanel .st-brand{font-size:11px;letter-spacing:.22em;font-weight:800;color:#ffc340;text-transform:uppercase;}' +
    '#stPanel h2{margin:3px 0 2px;font-size:20px;font-weight:900;}' +
    '#stPanel .st-x{position:absolute;top:12px;right:14px;background:rgba(255,255,255,.1);border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:19px;cursor:pointer;line-height:1;}' +
    '#stPanel .st-body{overflow-y:auto;padding:14px 16px 26px;-webkit-overflow-scrolling:touch;}' +
    '#stPanel .st-gps{border-radius:10px;padding:10px 12px;font-size:13.5px;font-weight:800;margin-bottom:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);}' +
    '#stPanel .st-gps small{font-weight:600;color:rgba(232,238,247,.6);}' +
    '#stPanel .st-gps.ok{border-color:#12a457;background:rgba(18,164,87,.14);}' +
    '#stPanel .st-gps.warn{border-color:#e8a012;background:rgba(232,160,18,.12);}' +
    '#stPanel .st-gps.bad{border-color:#e5484d;background:rgba(229,72,77,.12);}' +
    '#stPanel .st-von{display:flex;gap:8px;align-items:center;margin-bottom:12px;}' +
    '#stPanel .st-von label{font-size:12px;font-weight:700;color:rgba(232,238,247,.7);white-space:nowrap;}' +
    '#stPanel .st-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;}' +
    '#stPanel .st-tab{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#dbe6f5;border-radius:10px;padding:9px 4px;font-size:12px;font-weight:800;cursor:pointer;text-align:center;line-height:1.2;}' +
    '#stPanel .st-tab .i{font-size:17px;display:block;margin-bottom:2px;}' +
    '#stPanel .st-tab.on{background:linear-gradient(135deg,#0b5fff,#2196F3);border-color:transparent;color:#fff;}' +
    '#stPanel label.fl{display:block;font-size:11.5px;font-weight:700;color:rgba(232,238,247,.65);margin:10px 0 4px;}' +
    '#stPanel input,#stPanel textarea,#stPanel select{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);' +
      'color:#fff;border-radius:9px;padding:10px 11px;font-size:15px;font-family:inherit;}' +
    '#stPanel select option{background:#0e1826;color:#fff;}' +
    '#stPanel textarea{min-height:56px;resize:vertical;}' +
    '#stPanel .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
    '#stPanel .st-save{width:100%;margin-top:16px;border:0;border-radius:11px;padding:14px;font-size:15px;font-weight:900;color:#fff;' +
      'background:linear-gradient(135deg,#1c8a4a,#12a457);cursor:pointer;}' +
    '#stPanel .st-save:active{transform:scale(.99);}' +
    '#stPanel .st-status{font-size:11.5px;margin-top:8px;text-align:center;color:rgba(232,238,247,.55);min-height:16px;}' +
    '#stPanel .st-hint{font-size:11.5px;color:rgba(232,238,247,.5);margin-top:14px;line-height:1.5;background:rgba(255,255,255,.04);border-radius:9px;padding:9px 11px;}' +
    '#stPanel .st-sec{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:rgba(232,238,247,.5);margin:20px 0 8px;display:flex;justify-content:space-between;align-items:center;}' +
    '#stPanel .st-refresh{background:rgba(255,255,255,.1);border:0;color:#dbe6f5;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;}' +
    '#stPanel .st-item{background:rgba(255,255,255,.04);border-radius:10px;padding:9px 11px;margin-bottom:7px;border-left:3px solid var(--ec,#4a86c5);}' +
    '#stPanel .st-it-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;}' +
    '#stPanel .st-it-t{font-size:14px;font-weight:800;}' +
    '#stPanel .st-it-d{font-size:10.5px;color:rgba(232,238,247,.5);white-space:nowrap;}' +
    '#stPanel .st-it-s{font-size:12px;color:rgba(232,238,247,.75);margin-top:3px;}' +
    '#stPanel .st-it-m{font-size:10.5px;color:rgba(232,238,247,.45);margin-top:3px;}' +
    '#stPanel .st-del{background:rgba(229,72,77,.15);border:1px solid rgba(229,72,77,.5);color:#ff9b9b;border-radius:7px;' +
      'padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer;margin-top:6px;}' +
    '#stPanel .st-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:6px;vertical-align:middle;}' +
    '#stPanel .st-dot.ok{background:#12a457;} #stPanel .st-dot.off{background:#e8a012;}' +
    '#stPanel .st-empty{font-size:12.5px;color:rgba(232,238,247,.4);padding:8px 0;}' +
    '#stToast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);z-index:12050;background:#12a457;color:#fff;' +
      'font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:all .25s;}' +
    '#stToast.on{opacity:1;transform:translateX(-50%) translateY(0);} #stToast.err{background:#d63a3f;}';
  }

  var built = false, ov, panel, toastEl;
  function build(){
    if (built) return; built = true;
    var st = document.createElement('style'); st.textContent = css(); document.head.appendChild(st);

    ov = document.createElement('div'); ov.id = 'stOv'; document.body.appendChild(ov);
    panel = document.createElement('div'); panel.id = 'stPanel'; document.body.appendChild(panel);
    toastEl = document.createElement('div'); toastEl.id = 'stToast'; document.body.appendChild(toastEl);

    panel.innerHTML =
      '<div class="st-head"><button class="st-x" title="Schliessen">&times;</button>' +
        '<div class="st-brand">NalpSolar · STRABAG B8-13</div><h2>🔩 Stahlteile erfassen</h2></div>' +
      '<div class="st-body">' +
        '<div class="st-gps" id="stGps">📡 GPS: warte auf Position …</div>' +
        '<div class="st-von"><label>Erfasst von</label><input id="stVon" placeholder="Name / Kürzel"></div>' +
        '<div class="st-tabs" id="stTabs">' +
          '<button class="st-tab on" data-k="primaer"><span class="i">🏗</span>Primärkonstruktion vormontiert</button>' +
          '<button class="st-tab" data-k="teil"><span class="i">🔩</span>Loses Stahlteil</button>' +
        '</div>' +
        '<div id="stForm"></div>' +
        '<button class="st-save" id="stSave">📍 Am Standort speichern</button>' +
        '<div class="st-status" id="stStatus"></div>' +
        '<div class="st-hint">Der Eintrag wird am aktuellen GPS-Standort gespeichert und erscheint als Marker ' +
          'auf der 2D-Karte und im 3D-Modell. <b>Löschen:</b> Marker in der Karte / im 3D antippen ' +
          '(z.&nbsp;B. wenn das Teil verbaut oder abtransportiert wurde) – oder unten in der Liste.</div>' +
        '<div class="st-sec">Erfasste Stahlteile <button class="st-refresh" id="stRefresh">⟳ laden</button></div>' +
        '<div id="stList"></div>' +
      '</div>';

    panel.querySelectorAll('.st-tab').forEach(function(b){
      b.addEventListener('click', function(){ current = b.dataset.k; renderTabs(); renderForm(); });
    });
    panel.querySelector('#stVon').value = getVon();
    panel.querySelector('#stVon').addEventListener('change', function(){ setVon(this.value.trim()); });
    panel.querySelector('.st-x').addEventListener('click', close);
    panel.querySelector('#stSave').addEventListener('click', save);
    panel.querySelector('#stRefresh').addEventListener('click', function(){ setStatus('Lade …'); notify(); });
    ov.addEventListener('click', close);
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') close(); });

    renderForm();
  }

  function renderTabs(){
    panel.querySelectorAll('.st-tab').forEach(function(b){ b.classList.toggle('on', b.dataset.k===current); });
  }

  function renderForm(){
    var f = panel.querySelector('#stForm');
    if (current === 'primaer') {
      f.innerHTML =
        '<div class="row2">' +
          '<div><label class="fl">Tisch-ID</label><input id="f_tisch" inputmode="numeric" placeholder="z.B. 2104"></div>' +
          '<div><label class="fl">Typ (optional)</label><input id="f_typ" placeholder="z.B. D_2026"></div>' +
        '</div>' +
        '<label class="fl">Bemerkung (optional)</label><textarea id="f_bem" placeholder="z.B. liegt neben Baupiste, Lasche prüfen …"></textarea>';
    } else {
      f.innerHTML =
        '<label class="fl">Stahlteil</label>' +
        '<select id="f_teil">' + TEILE.map(function(t,i){ return '<option'+(i===0?' selected':'')+'>'+esc(t)+'</option>'; }).join('') + '</select>' +
        '<div class="row2">' +
          '<div><label class="fl">Anzahl</label><input id="f_anz" inputmode="numeric" value="1"></div>' +
          '<div><label class="fl">Tisch-ID (optional)</label><input id="f_tisch" inputmode="numeric" placeholder="falls zuordenbar"></div>' +
        '</div>' +
        '<label class="fl">Bemerkung (optional)</label><textarea id="f_bem" placeholder="z.B. Bund à 4 Stück, angerostet …"></textarea>';
    }
    setStatus('');
  }

  function val(id){ var el = panel.querySelector('#'+id); return el ? el.value.trim() : ''; }
  function setStatus(t, err){ var s = panel.querySelector('#stStatus'); if(!s) return; s.textContent = t||''; s.style.color = err ? '#ff9b9b' : 'rgba(232,238,247,.55)'; }
  function toast(msg, err){
    toastEl.textContent = msg; toastEl.className = 'on'+(err?' err':'');
    setTimeout(function(){ toastEl.className = err?'err':''; }, 2200);
  }

  function save(){
    var von = val('stVon'); setVon(von);
    if (!lastFix) { setStatus('Noch kein GPS-Fix – bitte kurz warten (Standort-Freigabe erteilt?).', true); return; }
    if (Date.now() - lastFix.t > 60000) { setStatus('GPS-Fix ist älter als 1 Minute – bitte auf neue Position warten.', true); return; }

    var rec = {
      art: current,
      teilTyp: current==='primaer' ? val('f_typ') : val('f_teil'),
      tischId: val('f_tisch'),
      anzahl: current==='teil' ? (val('f_anz')||'1') : '',
      bemerkung: val('f_bem'),
      von: von,
      datum: todayISO(),
      lat: lastFix.lat, lon: lastFix.lon, acc: Math.round(lastFix.acc),
      ts: Date.now()
    };
    if (current==='primaer' && !rec.tischId) { setStatus('Bitte die Tisch-ID der vormontierten Primärkonstruktion eingeben.', true); return; }

    // 1) sofort lokal sichern
    rec.fb = false;
    var log = lsLoad(); log.push(rec); lsSave(log);
    setStatus('Speichere …');

    // 2) Firebase (best effort)
    fbPush(rec).then(function(key){
      var l = lsLoad(); var i = l.map(function(r){ return r.ts; }).indexOf(rec.ts);
      if (key && i >= 0) {
        l[i].fb = true; l[i].key = key; lsSave(l);
        toast('✓ Gespeichert – Marker gesetzt');
        setStatus('In Firebase gespeichert (±'+rec.acc+' m).');
      } else if (key) {
        fbDelete(key).then(notify);   // Eintrag wurde noch vor Upload-Ende wieder gelöscht
        resetForm(); return;
      } else {
        toast('✓ Lokal gespeichert (offline)');
        setStatus('Firebase nicht erreichbar – lokal gesichert, Upload beim nächsten Öffnen.', true);
      }
      resetForm(); notify();
    });
  }

  function resetForm(){
    ['f_tisch','f_typ','f_bem'].forEach(function(id){ var el = panel.querySelector('#'+id); if (el) el.value=''; });
    var a = panel.querySelector('#f_anz'); if (a) a.value = '1';
  }

  function itemTitle(r){
    return r.art==='primaer'
      ? '🏗 PK vormontiert'+(r.tischId?' · Tisch '+r.tischId:'')+(r.teilTyp?' ('+r.teilTyp+')':'')
      : '🔩 '+(r.teilTyp||'Stahlteil')+(r.anzahl&&r.anzahl!=='1'?' × '+r.anzahl:'')+(r.tischId?' · Tisch '+r.tischId:'');
  }

  function renderList(items){
    var listEl = panel && panel.querySelector('#stList'); if (!listEl) return;
    if (!items.length) { listEl.innerHTML = '<div class="st-empty">Noch keine Stahlteile erfasst.</div>'; setStatus(''); return; }
    listEl.innerHTML = items.slice(0, 25).map(function(r, i){
      var syn = r.fb ? '<span class="st-dot ok" title="in Firebase"></span>' : '<span class="st-dot off" title="nur lokal"></span>';
      var ec = r.art==='primaer' ? '#0b5fff' : '#ff8a3d';
      return '<div class="st-item" style="--ec:'+ec+'">' +
        '<div class="st-it-top"><div class="st-it-t">'+esc(itemTitle(r))+syn+'</div><div class="st-it-d">'+esc(fmtDate(r.datum))+'</div></div>' +
        (r.bemerkung ? '<div class="st-it-s">'+esc(r.bemerkung)+'</div>' : '') +
        '<div class="st-it-m">'+esc(r.von||'—')+' · GPS ±'+esc(r.acc||'?')+' m</div>' +
        '<button class="st-del" data-i="'+i+'">🗑 Löschen (aufgeräumt/verbaut)</button>' +
      '</div>';
    }).join('');
    listEl.querySelectorAll('.st-del').forEach(function(b){
      b.addEventListener('click', function(){
        var it = items[Number(b.dataset.i)];
        if (!it) return;
        if (!window.confirm('„'+itemTitle(it)+'" löschen?')) return;
        removeItem(it, function(ok, msg){
          if (ok) toast('🗑 Gelöscht'); else { toast('Löschen fehlgeschlagen', true); setStatus(msg||'', true); }
        });
      });
    });
    setStatus('');
  }

  function open(){
    build();
    panel.querySelector('#stVon').value = getVon();
    ov.classList.add('on'); panel.classList.add('on');
    gpsStart(); paintGps();
    flushPending();
    setStatus('Lade …');
    notify();
  }
  function close(){
    if (ov) ov.classList.remove('on');
    if (panel) panel.classList.remove('on');
    gpsStop();
  }

  /* ---------- Öffentliche API ---------- */
  window.NalpStahlteile = {
    TEILE: TEILE,
    open: open,
    refresh: notify,
    remove: removeItem,
    itemTitle: itemTitle,
    subscribe: function (fn) {
      subscribers.push(fn);
      // initiale Daten liefern (asynchron)
      loadAll(function(items){ try{ fn(items); }catch(e){ console.warn('[nalp-stahlteile] subscriber', e); } });
    }
  };
  window.nalpStahlteileOpen = open;

  // offline erfasste Einträge beim Seitenstart hochladen
  if (document.readyState === 'complete' || document.readyState === 'interactive') flushPending();
  else document.addEventListener('DOMContentLoaded', flushPending);
})();
