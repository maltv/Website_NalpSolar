/*
 * nalp-erfassung.js — Baustellen-Erfassung für das NalpSolar-Portal.
 *
 * Erfasst 3 Arten von Einträgen und speichert sie in der Firebase Realtime
 * Database (anmeldefrei, REST) UND lokal (localStorage, offline-sicher):
 *   1) Primärkonstruktion montiert  -> erfassung/primaer
 *   2) Modulträger montiert         -> erfassung/modultraeger
 *   3) Besonderes Vorkommnis        -> erfassung/vorkommnis
 *
 * Datenstruktur je Datensatz (alle Felder Strings ausser ts):
 *   primaer      : { art, tischId, typ, datum, bemerkung, von, ts }
 *   modultraeger : { art, tischId, typ, datum, bemerkung, von, ts }
 *   vorkommnis   : { art, tischId, titel, text, schwere, datum, von, ts }
 *
 * Einbindung: <script src="assets/js/nalp-erfassung.js"></script>
 * Öffnen:     window.nalpErfassenOpen()   (z.B. per Button)
 *
 * HINWEIS Sicherheit: Die Realtime DB ist (wie die Spiel-Rangliste) ohne
 * Login beschreibbar. Für internen Baustellengebrauch hinter dem 6460-Gate ok;
 * für echten Schutz später Firebase-Auth + Security-Rules einrichten.
 */
(function () {
  'use strict';

  var DB = 'https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app';
  var LS_LOG = 'nalp_erfassung_log_v1';   // lokaler Spiegel aller Einträge dieses Geräts
  var LS_VON = 'nalp_erfasser_v1';        // Name "Erfasst von"

  var KINDS = {
    primaer:      { label: 'Primärkonstruktion', icon: '🏗️', path: 'erfassung/primaer' },
    modultraeger: { label: 'Modulträger',        icon: '▦',  path: 'erfassung/modultraeger' },
    vorkommnis:   { label: 'Vorkommnis',         icon: '⚠️', path: 'erfassung/vorkommnis' }
  };
  var SCHWERE = ['Info', 'Mittel', 'Hoch', 'Stopp'];

  var current = 'primaer';

  // ---------- Helpers ----------
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function todayISO(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function fmtDate(iso){ if(!iso) return ''; var p=String(iso).split('-'); return p.length===3 ? p[2]+'.'+p[1]+'.'+p[0] : iso; }

  function lsLoad(){ try{ return JSON.parse(localStorage.getItem(LS_LOG)||'[]'); }catch(e){ return []; } }
  function lsSave(arr){ try{ localStorage.setItem(LS_LOG, JSON.stringify(arr.slice(-500))); }catch(e){} }
  function getVon(){ try{ return localStorage.getItem(LS_VON)||''; }catch(e){ return ''; } }
  function setVon(v){ try{ localStorage.setItem(LS_VON, v||''); }catch(e){} }

  function fbPush(kind, rec){
    return fetch(DB+'/'+KINDS[kind].path+'.json', { method:'POST', body: JSON.stringify(rec) })
      .then(function(r){ return r.ok; }).catch(function(){ return false; });
  }
  function fbList(kind){
    return fetch(DB+'/'+KINDS[kind].path+'.json')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(obj){
        if(!obj) return [];
        return Object.keys(obj).map(function(k){ return obj[k]; }).filter(Boolean);
      }).catch(function(){ return null; });
  }

  // ---------- UI ----------
  function css(){
    return '' +
    '#neOv{position:fixed;inset:0;z-index:12000;background:rgba(4,10,18,.55);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .2s;}' +
    '#neOv.on{opacity:1;pointer-events:auto;}' +
    '#nePanel{position:fixed;top:0;right:0;bottom:0;z-index:12001;width:min(440px,94vw);transform:translateX(103%);' +
      'transition:transform .28s cubic-bezier(.4,0,.2,1);background:#0e1826;color:#e8eef7;box-shadow:-8px 0 40px rgba(0,0,0,.5);' +
      'display:flex;flex-direction:column;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;}' +
    '#nePanel.on{transform:translateX(0);}' +
    '#nePanel .ne-head{padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.08);background:radial-gradient(120% 100% at 100% 0,#173657,#0e1826);position:relative;}' +
    '#nePanel .ne-brand{font-size:11px;letter-spacing:.22em;font-weight:800;color:#ffc340;text-transform:uppercase;}' +
    '#nePanel h2{margin:3px 0 2px;font-size:20px;font-weight:900;}' +
    '#nePanel .ne-x{position:absolute;top:12px;right:14px;background:rgba(255,255,255,.1);border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:19px;cursor:pointer;line-height:1;}' +
    '#nePanel .ne-body{overflow-y:auto;padding:14px 16px 26px;-webkit-overflow-scrolling:touch;}' +
    '#nePanel .ne-von{display:flex;gap:8px;align-items:center;margin-bottom:12px;}' +
    '#nePanel .ne-von label{font-size:12px;font-weight:700;color:rgba(232,238,247,.7);white-space:nowrap;}' +
    '#nePanel .ne-tabs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:14px;}' +
    '#nePanel .ne-tab{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#dbe6f5;border-radius:10px;padding:9px 4px;font-size:12px;font-weight:800;cursor:pointer;text-align:center;line-height:1.2;}' +
    '#nePanel .ne-tab .i{font-size:17px;display:block;margin-bottom:2px;}' +
    '#nePanel .ne-tab.on{background:linear-gradient(135deg,#0b5fff,#2196F3);border-color:transparent;color:#fff;}' +
    '#nePanel label.fl{display:block;font-size:11.5px;font-weight:700;color:rgba(232,238,247,.65);margin:10px 0 4px;}' +
    '#nePanel input,#nePanel textarea,#nePanel select{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);' +
      'color:#fff;border-radius:9px;padding:10px 11px;font-size:15px;font-family:inherit;}' +
    '#nePanel textarea{min-height:64px;resize:vertical;}' +
    '#nePanel .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
    '#nePanel .ne-save{width:100%;margin-top:16px;border:0;border-radius:11px;padding:14px;font-size:15px;font-weight:900;color:#fff;' +
      'background:linear-gradient(135deg,#1c8a4a,#12a457);cursor:pointer;}' +
    '#nePanel .ne-save:active{transform:scale(.99);}' +
    '#nePanel .ne-status{font-size:11.5px;margin-top:8px;text-align:center;color:rgba(232,238,247,.55);min-height:16px;}' +
    '#nePanel .ne-sec{font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:rgba(232,238,247,.5);margin:22px 0 8px;display:flex;justify-content:space-between;align-items:center;}' +
    '#nePanel .ne-refresh{background:rgba(255,255,255,.1);border:0;color:#dbe6f5;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;}' +
    '#nePanel .ne-item{background:rgba(255,255,255,.04);border-radius:10px;padding:9px 11px;margin-bottom:7px;border-left:3px solid var(--ec,#4a86c5);}' +
    '#nePanel .ne-it-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;}' +
    '#nePanel .ne-it-t{font-size:14px;font-weight:800;}' +
    '#nePanel .ne-it-d{font-size:10.5px;color:rgba(232,238,247,.5);white-space:nowrap;}' +
    '#nePanel .ne-it-s{font-size:12px;color:rgba(232,238,247,.75);margin-top:3px;}' +
    '#nePanel .ne-it-m{font-size:10.5px;color:rgba(232,238,247,.45);margin-top:3px;}' +
    '#nePanel .ne-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:6px;vertical-align:middle;}' +
    '#nePanel .ne-dot.ok{background:#12a457;} #nePanel .ne-dot.off{background:#e8a012;}' +
    '#nePanel .ne-empty{font-size:12.5px;color:rgba(232,238,247,.4);padding:8px 0;}' +
    '#nePanel .ne-all{display:block;text-align:center;margin-top:14px;padding:11px;border-radius:10px;background:rgba(255,255,255,.08);color:#dbe6f5;font-weight:800;font-size:13px;text-decoration:none;}' +
    '#nePanel .ne-all:hover{background:rgba(255,255,255,.16);}' +
    '#neToast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);z-index:12050;background:#12a457;color:#fff;' +
      'font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:all .25s;}' +
    '#neToast.on{opacity:1;transform:translateX(-50%) translateY(0);} #neToast.err{background:#d63a3f;}';
  }

  var built = false, ov, panel, toastEl;
  function build(){
    if(built) return; built = true;
    var st=document.createElement('style'); st.textContent=css(); document.head.appendChild(st);

    ov=document.createElement('div'); ov.id='neOv'; document.body.appendChild(ov);
    panel=document.createElement('div'); panel.id='nePanel'; document.body.appendChild(panel);
    toastEl=document.createElement('div'); toastEl.id='neToast'; document.body.appendChild(toastEl);

    panel.innerHTML =
      '<div class="ne-head"><button class="ne-x" title="Schliessen">&times;</button>' +
        '<div class="ne-brand">NalpSolar · STRABAG B8-13</div><h2>🖉 Erfassen</h2></div>' +
      '<div class="ne-body">' +
        '<div class="ne-von"><label>Erfasst von</label><input id="neVon" placeholder="Name / Kürzel"></div>' +
        '<div class="ne-tabs" id="neTabs"></div>' +
        '<div id="neForm"></div>' +
        '<button class="ne-save" id="neSave">Speichern</button>' +
        '<div class="ne-status" id="neStatus"></div>' +
        '<div class="ne-sec">Letzte Einträge <button class="ne-refresh" id="neRefresh">⟳ laden</button></div>' +
        '<div id="neList"></div>' +
        '<a class="ne-all" href="erfassungen.html">📋 Alle Erfassungen als Tabelle öffnen →</a>' +
      '</div>';

    // Tabs
    var tabs=panel.querySelector('#neTabs');
    Object.keys(KINDS).forEach(function(k){
      var b=document.createElement('button'); b.className='ne-tab'+(k===current?' on':''); b.dataset.k=k;
      b.innerHTML='<span class="i">'+KINDS[k].icon+'</span>'+KINDS[k].label;
      b.addEventListener('click', function(){ current=k; renderTabs(); renderForm(); renderList(); });
      tabs.appendChild(b);
    });

    panel.querySelector('#neVon').value = getVon();
    panel.querySelector('#neVon').addEventListener('change', function(){ setVon(this.value.trim()); });
    panel.querySelector('.ne-x').addEventListener('click', close);
    panel.querySelector('#neSave').addEventListener('click', save);
    panel.querySelector('#neRefresh').addEventListener('click', function(){ renderList(true); });
    ov.addEventListener('click', close);
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') close(); });

    renderForm();
  }

  function renderTabs(){
    panel.querySelectorAll('.ne-tab').forEach(function(b){ b.classList.toggle('on', b.dataset.k===current); });
  }

  function renderForm(){
    var f=panel.querySelector('#neForm');
    if(current==='vorkommnis'){
      f.innerHTML =
        '<div class="row2">' +
          '<div><label class="fl">Tisch-ID (optional)</label><input id="f_tisch" inputmode="numeric" placeholder="z.B. 1883"></div>' +
          '<div><label class="fl">Datum</label><input id="f_datum" type="date" value="'+todayISO()+'"></div>' +
        '</div>' +
        '<label class="fl">Schweregrad</label>' +
        '<select id="f_schwere">'+SCHWERE.map(function(s,i){return '<option'+(i===0?' selected':'')+'>'+s+'</option>';}).join('')+'</select>' +
        '<label class="fl">Titel</label><input id="f_titel" placeholder="Kurz, was ist passiert">' +
        '<label class="fl">Beschreibung</label><textarea id="f_text" placeholder="Details, Ort, Massnahme …"></textarea>';
    } else {
      var was = current==='primaer' ? 'Primärkonstruktion' : 'Modulträger';
      f.innerHTML =
        '<div class="row2">' +
          '<div><label class="fl">Tisch-ID</label><input id="f_tisch" inputmode="numeric" placeholder="z.B. 1883"></div>' +
          '<div><label class="fl">Typ (optional)</label><input id="f_typ" placeholder="z.B. D_2025"></div>' +
        '</div>' +
        '<label class="fl">'+was+' montiert am</label><input id="f_datum" type="date" value="'+todayISO()+'">' +
        '<label class="fl">Bemerkung (optional)</label><textarea id="f_bemerkung" placeholder="z.B. Position, Auffälligkeit …"></textarea>';
    }
    setStatus('');
  }

  function val(id){ var el=panel.querySelector('#'+id); return el ? el.value.trim() : ''; }
  function setStatus(t, err){ var s=panel.querySelector('#neStatus'); s.textContent=t||''; s.style.color=err?'#ff9b9b':'rgba(232,238,247,.55)'; }

  function toast(msg, err){
    toastEl.textContent=msg; toastEl.className='on'+(err?' err':'');
    setTimeout(function(){ toastEl.className=err?'err':''; }, 2200);
  }

  function save(){
    var von = val('neVon'); setVon(von);
    var datum = val('f_datum') || todayISO();
    var tischId = val('f_tisch');
    var rec, ok=true, msg='';

    if(current==='vorkommnis'){
      var titel=val('f_titel');
      if(!titel){ ok=false; msg='Bitte einen Titel eingeben.'; }
      rec={ art:'vorkommnis', tischId:tischId, titel:titel, text:val('f_text'),
            schwere:val('f_schwere')||'Info', datum:datum, von:von, ts:Date.now() };
    } else {
      if(!tischId){ ok=false; msg='Bitte die Tisch-ID eingeben.'; }
      rec={ art:current, tischId:tischId, typ:val('f_typ'), bemerkung:val('f_bemerkung'),
            datum:datum, von:von, ts:Date.now() };
    }
    if(!ok){ setStatus(msg, true); return; }

    // 1) sofort lokal sichern
    rec.fb=false;
    var log=lsLoad(); log.push(rec); lsSave(log);
    renderList();
    setStatus('Speichere …');

    // 2) Firebase (best effort)
    var kind=current;
    fbPush(kind, stripLocal(rec)).then(function(success){
      if(success){ rec.fb=true; var l=lsLoad(); var idx=l.map(function(r){return r.ts;}).indexOf(rec.ts); if(idx>=0){ l[idx].fb=true; lsSave(l); }
        toast('✓ Gespeichert (Firebase)'); setStatus('In Firebase gespeichert.');
      } else {
        toast('✓ Lokal gespeichert (offline)'); setStatus('Firebase nicht erreichbar – lokal gesichert, wird beim nächsten Öffnen erneut versucht.', true);
      }
      resetForm(); renderList();
    });
  }

  function stripLocal(rec){ var c={}; Object.keys(rec).forEach(function(k){ if(k!=='fb') c[k]=rec[k]; }); return c; }

  function resetForm(){
    ['f_tisch','f_typ','f_titel','f_text','f_bemerkung'].forEach(function(id){ var el=panel.querySelector('#'+id); if(el) el.value=''; });
  }

  // pending (nicht synchronisierte) lokale Einträge erneut hochladen
  function flushPending(){
    var log=lsLoad(); var pend=log.filter(function(r){ return r.fb!==true; });
    if(!pend.length) return;
    pend.forEach(function(r){
      fbPush(r.art, stripLocal(r)).then(function(ok){
        if(ok){ var l=lsLoad(); var i=l.map(function(x){return x.ts;}).indexOf(r.ts); if(i>=0){ l[i].fb=true; lsSave(l); renderList(); } }
      });
    });
  }

  function sevColor(s){ return ({Info:'#4a86c5',Mittel:'#ffd23f',Hoch:'#ff8a3d',Stopp:'#e5484d'})[s]||'#4a86c5'; }

  function renderList(fromFb){
    var listEl=panel.querySelector('#neList'); if(!listEl) return;
    var kind=current;
    var local=lsLoad().filter(function(r){ return r.art===kind; });

    function paint(items){
      // dedupe nach ts, neueste zuerst
      var byTs={}; items.forEach(function(r){ if(r && r.ts!=null) byTs[r.ts]=Object.assign({}, byTs[r.ts]||{}, r); });
      var arr=Object.keys(byTs).map(function(k){return byTs[k];}).sort(function(a,b){ return (b.ts||0)-(a.ts||0); }).slice(0,20);
      if(!arr.length){ listEl.innerHTML='<div class="ne-empty">Noch keine Einträge.</div>'; return; }
      listEl.innerHTML = arr.map(function(r){
        var title, sub, ec;
        if(kind==='vorkommnis'){ title=(r.titel||'(ohne Titel)')+(r.tischId?' · Tisch '+esc(r.tischId):''); sub=esc(r.text||''); ec=sevColor(r.schwere); }
        else { title='Tisch '+esc(r.tischId||'?')+(r.typ?' · '+esc(r.typ):''); sub=esc(r.bemerkung||''); ec=(kind==='primaer'?'#0b5fff':'#12a457'); }
        var syn = r.fb===false ? '<span class="ne-dot off" title="nur lokal"></span>' : '<span class="ne-dot ok" title="in Firebase"></span>';
        return '<div class="ne-item" style="--ec:'+ec+'">' +
          '<div class="ne-it-top"><div class="ne-it-t">'+esc(title)+syn+'</div><div class="ne-it-d">'+esc(fmtDate(r.datum))+'</div></div>' +
          (sub?'<div class="ne-it-s">'+sub+'</div>':'') +
          '<div class="ne-it-m">'+esc(r.von||'—')+(kind==='vorkommnis'?' · '+esc(r.schwere||''):'')+'</div>' +
        '</div>';
      }).join('');
    }

    paint(local);
    if(fromFb){
      setStatus('Lade aus Firebase …');
      fbList(kind).then(function(remote){
        if(remote===null){ setStatus('Firebase nicht erreichbar – zeige lokale Einträge.', true); return; }
        setStatus('');
        remote.forEach(function(r){ r.fb=true; });
        paint(local.concat(remote));
      });
    }
  }

  function open(){ build(); panel.querySelector('#neVon').value=getVon(); ov.classList.add('on'); panel.classList.add('on'); flushPending(); renderList(true); }
  function close(){ if(ov) ov.classList.remove('on'); if(panel) panel.classList.remove('on'); }

  window.nalpErfassenOpen = open;
})();
