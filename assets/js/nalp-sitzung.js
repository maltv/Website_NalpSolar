/* ═══════════════════════════════════════════════════════════════════
   nalp-sitzung.js — Koordinationssitzung führen statt abtippen
   ═══════════════════════════════════════════════════════════════════
   Auftrag Victor 26.08.2026: das Protokoll der Koordinationssitzung
   BF/PL läuft künftig hier im Admin und nicht mehr in OneNote.

   Der Aufbau folgt eins zu eins dem, was im Hörbuch «Kurze Sitzungen
   sauber führen» (25.08.2026) steht und was seit dem 27.08.2026 im
   Terminkörper des Serientermins vereinbart ist:

     · fester Ablauf, immer gleiche Reihenfolge, mit angesagter Zeit
       (5' Zahlen · je 5' Bohren+Injektion / Stahlbau+Vormontage /
        Verschrauben / Werkleitungen+Erdbau · 5' Sicherheit ·
        15' Pendenzen · 15' offene Diskussion)
     · der PARKPLATZ als wichtigstes Werkzeug: was nicht in die laufende
       Box gehört, wird sichtbar aufgeschrieben statt weggeredet, und
       bekommt am Schluss eine Erledigung
     · kein Punkt ohne Namen und Datum – eine Pendenz lässt sich hier
       ohne «wer» und «bis» gar nicht speichern
     · maximal fünf Punkte, über die wirklich diskutiert wird
     · Abgleich zur letzten Sitzung als eigener Block, damit jeder Punkt
       des Vorprotokolls wieder aufgegriffen wird
     · und was gut läuft, wird ausdrücklich festgehalten

   Daten in der RTDB:
     erfassung/sitzungen/<JJJJ-MM-TT>       ganzer Protokollsatz (PUT)
     erfassung/sitzung_pendenzen/<pendId>   Statusüberlagerung je Pendenz
   Getrennt gehalten wie beim Störungsregister: die Sitzung selbst wird
   am Stück geschrieben, der Stand einer Pendenz ändert sich später in
   einer anderen Sitzung und darf den alten Satz nicht überschreiben.

   OFFLINE: Der Container Berg hat nicht immer Netz. Jede Änderung geht
   zuerst in den localStorage und erst danach in die RTDB; beim nächsten
   Netz wird nachgeschoben. Es sind nur Texte, keine Fotos – localStorage
   reicht (anders als bei nalp-lager.js / nalp-ueberstand.js).

   Einbau:  NalpSitzung.start(wurzelElement)
   ═══════════════════════════════════════════════════════════════════ */
window.NalpSitzung = (function () {
'use strict';

var DB    = 'https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app';
var P_SITZ = 'erfassung/sitzungen';
var P_PEND = 'erfassung/sitzung_pendenzen';
var P_VM   = 'erfassung/vm_fortschritt';
var LS_OFF = 'nalp_sitzung_offen_v1';   /* noch nicht gespiegelte Sätze */
var LS_WER = 'nalp_user_name_v1';       /* gleicher Schlüssel wie nalp-protokoll.js */

/* ── Die Runde. Wer erforderlich ist, steht im Serientermin
      (bereinigt 25.08.2026: Mike Berndt raus, Kristjan und Nicolas neu). ── */
var RUNDE = [
  { id:'victor',   name:'Victor Malt',        rolle:'Bauleitung / Leitung',   fest:true },
  { id:'samuel',   name:'Samuel Decurtins',   rolle:'Polier',                 fest:true },
  { id:'kristjan', name:'Kristjan Kullamaa',  rolle:'Vermessung / Absteckung',fest:true },
  { id:'nicolas',  name:'Nicolas Champion',   rolle:'Geowork',                fest:true },
  { id:'chris',    name:'Christopher Zimmermann', rolle:'Logistik',           fest:true },
  { id:'lukas',    name:'Lukas Kälin',        rolle:'Werkleitungen / Erdbau', fest:false },
  { id:'francois', name:'François Borner',    rolle:'Bauleitung AG-Seite',    fest:false }
];

/* ── Der feste Ablauf. dauer = Sollzeit in Minuten (Summe 60). ── */
var ABLAUF = [
  { id:'zahlen',       titel:'Zahlen & Programmabgleich', dauer:5,
    hilfe:'Vorlesen, nicht diskutieren. Wer eine Zahl anzweifelt: Pendenz, kein Sitzungsthema.' },
  { id:'bohren',       titel:'Bohren · Injektion · Vermessung', dauer:5,
    hilfe:'Stand, was blockiert, was diese Woche drankommt.' },
  { id:'stahlbau',     titel:'Stahlbau & Vormontage', dauer:5,
    hilfe:'Primärkonstruktion, Modulträger, Vorrat im Tal, Material.' },
  { id:'verschrauben', titel:'Verschrauben', dauer:5,
    hilfe:'Erfassung, Nachbesserungen, Drehmomente.' },
  { id:'werkleitungen',titel:'Werkleitungen & Erdbau', dauer:5,
    hilfe:'Feinverteilung, Schächte, Erdung, Baupisten.' },
  { id:'sicherheit',   titel:'Sicherheit & Umwelt', dauer:5,
    hilfe:'Ereignisse seit der letzten Sitzung, Unterweisungen, UBB.' },
  { id:'pendenzen',    titel:'Pendenzen', dauer:15,
    hilfe:'Offene Punkte durchgehen – jeder bekommt Name und Datum.' },
  { id:'offen',        titel:'Offene Diskussion', dauer:15,
    hilfe:'Jetzt kommt der Parkplatz dran. Alles, was liegen geblieben ist.' }
];

/* Thematischer Schwerpunkt je Wochentag – so in der Einladung vereinbart. */
var SCHWERPUNKT = {
  2:'Dienstag: 5W-Programm · Personalbedarf · Pendenzen',
  4:'Donnerstag: Leistungswerte · Abgleich Gesamtbauprogramm'
};

var PSTATUS = [
  { id:'offen',      n:'offen',      f:'#FBE9E7', r:'#D72622' },
  { id:'laeuft',     n:'läuft',      f:'#FFF4E0', r:'#e08a00' },
  { id:'erledigt',   n:'erledigt',   f:'#E8F6EC', r:'#2e9e46' },
  { id:'verschoben', n:'verschoben', f:'#eef0f2', r:'#63676d' }
];

/* ── Zustand ──────────────────────────────────────────────── */
var ZIEL=null, BLATT='sitzung', GESTARTET=false;
var SITZUNGEN={};        /* datum -> Satz */
var PUEBER={};           /* pendenzId -> {status,bemerkung,ts,von} */
var AKTIV=null;          /* Datum der geführten Sitzung */
var LIVE=null;           /* live gerechnete Zahlen (Fallback + Vergleich) */
var TIMER={ box:null, start:0, tick:null };
var speicherWartet=null, netzOk=true;
var pendFilter='offen', archivWahl=null;

function $(id){ return document.getElementById(id); }
function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function z2(n){ return String(n).padStart(2,'0'); }
function heute(){ var d=new Date(); return d.getFullYear()+'-'+z2(d.getMonth()+1)+'-'+z2(d.getDate()); }
function deDat(iso){ if(!iso||iso.length<10) return iso||''; return iso.slice(8,10)+'.'+iso.slice(5,7)+'.'+iso.slice(0,4); }
function wochentag(iso){ var d=new Date(iso+'T12:00:00');
  return ['So','Mo','Di','Mi','Do','Fr','Sa'][d.getDay()]; }
function kw(d){ var t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));
  return Math.ceil(((t-Date.UTC(t.getUTCFullYear(),0,1))/86400000+1)/7); }
function wer(){ try { return localStorage.getItem(LS_WER)||''; } catch(e){ return ''; } }
function werSetzen(n){ try { localStorage.setItem(LS_WER,n); } catch(e){} }
function neueId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

/* Nächster Sitzungstermin ab heute: Dienstag oder Donnerstag. */
function naechsterTermin(){
  var d=new Date();
  for(var i=0;i<8;i++){
    var t=new Date(d.getTime()+i*86400000);
    if(t.getDay()===2||t.getDay()===4)
      return t.getFullYear()+'-'+z2(t.getMonth()+1)+'-'+z2(t.getDate());
  }
  return heute();
}

/* ═══════════════════════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════════════════════ */
var CSS=[
'.si-nav{display:flex;gap:0;overflow-x:auto;background:#1a1a1a;position:sticky;top:43px;z-index:499}',
'.si-nav button{flex:1 0 auto;border:none;background:none;cursor:pointer;color:#b9bec5;',
'  font:700 12.5px Arial;padding:9px 13px 8px;border-bottom:3px solid transparent;white-space:nowrap}',
'.si-nav button.on{color:#fff;border-bottom-color:#D72622;background:#26292e}',
'.si-nav button i{font-style:normal;display:inline-block;min-width:15px;height:15px;line-height:15px;',
'  border-radius:8px;font-size:10px;font-weight:900;margin-left:5px;padding:0 4px;background:#D72622;color:#fff}',

'.si-kopf{background:#fff;border:1px solid #e3e5e8;border-left:5px solid #D72622;border-radius:6px;',
'  padding:12px 14px;margin-bottom:12px;box-shadow:0 1px 4px rgba(20,25,32,.07)}',
'.si-kopf h2{margin:0 0 3px;font-size:17px}',
'.si-kopf .wann{font-size:12.5px;color:#63676d;font-weight:700;margin-bottom:9px}',
'.si-feld{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px}',
'.si-feld label{display:block;font-size:11px;color:#63676d;font-weight:700;margin-bottom:3px}',
'.si-feld input,.si-feld select{font:inherit;font-size:14px;padding:7px 9px;border:1px solid #c9ccd2;',
'  border-radius:5px;background:#fff;color:#1a1a1a}',

'.si-runde{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 2px}',
'.si-pers{border:1px solid #c9ccd2;border-radius:20px;padding:5px 12px;font-size:12.5px;font-weight:700;',
'  cursor:pointer;background:#f6f7f9;color:#63676d;user-select:none}',
'.si-pers.da{background:#E8F6EC;border-color:#9fd5b0;color:#1c6b34}',
'.si-pers.fehlt{background:#FBE9E7;border-color:#f0bdb8;color:#a3231f;text-decoration:line-through}',

'.si-uhr{position:sticky;top:76px;z-index:498;background:#14181d;color:#fff;border-radius:6px;',
'  padding:9px 13px;margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;',
'  box-shadow:0 2px 10px rgba(0,0,0,.25)}',
'.si-uhr .gr{font-size:22px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1}',
'.si-uhr .wo{font-size:12px;color:#b9bec5;font-weight:700;flex:1;min-width:120px}',
'.si-uhr .bal{height:6px;border-radius:4px;background:#2c3138;overflow:hidden;flex-basis:100%}',
'.si-uhr .bal i{display:block;height:100%;background:#2e9e46}',
'.si-uhr.warn .gr{color:#ffcf4d}.si-uhr.ueber .gr{color:#ff6b62}',
'.si-uhr.ueber .bal i{background:#D72622}',

'.si-box{background:#fff;border:1px solid #e3e5e8;border-radius:6px;margin-bottom:10px;overflow:hidden}',
'.si-box.laeuft{border-color:#D72622;box-shadow:0 0 0 2px rgba(215,38,34,.14)}',
'.si-box>.k{display:flex;align-items:center;gap:9px;padding:10px 13px;background:#f6f7f9;',
'  border-bottom:1px solid #e3e5e8;flex-wrap:wrap;cursor:pointer}',
'.si-box>.k b{font-size:14.5px;flex:1;min-width:130px}',
'.si-box>.k .min{font-size:11.5px;font-weight:700;color:#63676d;background:#fff;border:1px solid #e3e5e8;',
'  border-radius:12px;padding:2px 9px;white-space:nowrap;font-variant-numeric:tabular-nums}',
'.si-box>.k .min.ueber{background:#FBE9E7;border-color:#f0bdb8;color:#a3231f}',
'.si-box>.k .min.fertig{background:#E8F6EC;border-color:#9fd5b0;color:#1c6b34}',
'.si-box .inn{padding:11px 13px}',
'.si-box .hilfe{font-size:11.5px;color:#63676d;margin-bottom:7px;line-height:1.5}',
'.si-box textarea{width:100%;min-height:78px;font:inherit;font-size:14px;line-height:1.55;padding:9px 10px;',
'  border:1px solid #c9ccd2;border-radius:5px;resize:vertical;background:#fff;color:#1a1a1a}',
'.si-box .zeilen{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}',

'.si-kn{border:none;border-radius:5px;padding:8px 13px;font:700 13px Arial;cursor:pointer;',
'  background:#eef0f2;color:#1a1a1a}',
'.si-kn.rot{background:#D72622;color:#fff}.si-kn.gruen{background:#2e9e46;color:#fff}',
'.si-kn.dunkel{background:#14181d;color:#fff}',
'.si-kn.mini{padding:5px 10px;font-size:12px}',
'.si-kn[disabled]{opacity:.42;cursor:default}',
'.si-kn.hoert{background:#D72622;color:#fff}',

'.si-park{background:#fffdf5;border:1px solid #e8d9a8;border-left:5px solid #e08a00;border-radius:6px;',
'  padding:12px 14px;margin-bottom:12px}',
'.si-park h3{margin:0 0 3px;font-size:15px;color:#8a5a00}',
'.si-park .sub{font-size:11.5px;color:#8a7440;margin-bottom:9px;line-height:1.5}',
'.si-park ul{list-style:none;margin:0;padding:0}',
'.si-park li{background:#fff;border:1px solid #ecdcb0;border-radius:5px;padding:8px 10px;margin-bottom:6px;',
'  font-size:13.5px;line-height:1.45}',
'.si-park li .von{font-size:11.5px;color:#8a7440;font-weight:700}',
'.si-park li.erl{opacity:.55}',
'.si-park li .wahl{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}',

'.si-tab{width:100%;border-collapse:collapse;font-size:13px;background:#fff}',
'.si-tab th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#63676d;',
'  padding:7px 8px;border-bottom:1px solid #e3e5e8;background:#f6f7f9;white-space:nowrap}',
'.si-tab td{padding:7px 8px;border-bottom:1px solid #eef0f2;vertical-align:top;line-height:1.45}',
'.si-tab tr:last-child td{border-bottom:0}',
'.si-amp{display:inline-block;border-radius:11px;padding:2px 9px;font-size:11.5px;font-weight:700}',

'.si-neu{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end;background:#f6f7f9;border:1px solid #e3e5e8;',
'  border-radius:6px;padding:10px 11px;margin-top:9px}',
'.si-neu label{display:block;font-size:10.5px;color:#63676d;font-weight:700;margin-bottom:3px}',
'.si-neu input,.si-neu select{font:inherit;font-size:13.5px;padding:7px 8px;border:1px solid #c9ccd2;',
'  border-radius:5px;background:#fff;color:#1a1a1a}',
'.si-neu .was{flex:1 1 240px;min-width:0}.si-neu .was input{width:100%}',
'.si-neu .wrn{flex-basis:100%;font-size:11.5px;color:#a3231f;font-weight:700}',

'.si-kach{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:8px;margin-bottom:10px}',
'.si-kach div{background:#fff;border:1px solid #e3e5e8;border-top:3px solid #D72622;border-radius:5px;padding:8px 10px}',
'.si-kach b{display:block;font-size:20px;font-weight:900;line-height:1.15;font-variant-numeric:tabular-nums}',
'.si-kach span{font-size:10.5px;color:#63676d;font-weight:700;line-height:1.35;display:block}',

'.si-reden{background:#fff;border:1px solid #e3e5e8;border-left:5px solid #14181d;border-radius:6px;',
'  padding:12px 14px;margin-bottom:12px}',
'.si-reden h3{margin:0 0 3px;font-size:15px}',
'.si-reden .sub{font-size:11.5px;color:#63676d;margin-bottom:9px;line-height:1.5}',
'.si-reden .zeile{display:flex;gap:7px;align-items:center;margin-bottom:6px}',
'.si-reden .nr{width:21px;height:21px;border-radius:50%;background:#14181d;color:#fff;font:900 11.5px Arial;',
'  display:flex;align-items:center;justify-content:center;flex:0 0 auto}',
'.si-reden input{flex:1;min-width:0;font:inherit;font-size:14px;padding:7px 9px;border:1px solid #c9ccd2;',
'  border-radius:5px;background:#fff;color:#1a1a1a}',

'.si-lob{background:#E8F6EC;border:1px solid #9fd5b0;border-left:5px solid #2e9e46;border-radius:6px;',
'  padding:12px 14px;margin-bottom:12px}',
'.si-lob h3{margin:0 0 3px;font-size:15px;color:#1c6b34}',
'.si-lob .sub{font-size:11.5px;color:#3d7a52;margin-bottom:8px;line-height:1.5}',
'.si-lob textarea{width:100%;min-height:52px;font:inherit;font-size:14px;padding:8px 10px;',
'  border:1px solid #9fd5b0;border-radius:5px;resize:vertical;background:#fff;color:#1a1a1a}',

'.si-fuss{position:sticky;bottom:0;z-index:497;background:#14181d;border-radius:8px 8px 0 0;',
'  padding:9px 12px;display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:14px;',
'  box-shadow:0 -2px 12px rgba(0,0,0,.22)}',
'.si-fuss .st{font-size:11.5px;color:#b9bec5;font-weight:700;flex:1;min-width:110px}',
'.si-fuss .st.off{color:#ffcf4d}',
'.si-fuss input{flex:1 1 190px;min-width:0;font:inherit;font-size:13.5px;padding:8px 10px;',
'  border:1px solid #3a4048;border-radius:5px;background:#20252b;color:#fff}',
'.si-fuss input::placeholder{color:#7d858e}',

'.si-hin{font-size:12px;color:#63676d;line-height:1.55;background:#f6f7f9;border:1px solid #e3e5e8;',
'  border-radius:6px;padding:10px 12px;margin-bottom:12px}',
'.si-leer{text-align:center;color:#63676d;font-size:13px;padding:22px 10px}',
'@media(max-width:520px){.si-uhr{top:76px}.si-neu .was{flex-basis:100%}}'
].join('\n');

/* ═══════════════════════════════════════════════════════════
   Start
   ═══════════════════════════════════════════════════════════ */
function start(el){
  ZIEL=el;
  if(!$('si-css')){ var s=document.createElement('style'); s.id='si-css'; s.textContent=CSS;
    document.head.appendChild(s); }
  if(GESTARTET){ zeichnen(); return; }
  GESTARTET=true;
  ZIEL.innerHTML='<div class="si-nav" id="siNav"></div><div class="wrap" id="siInhalt">'
    +'<div class="si-hin">lade …</div></div>';
  if(location.hash.indexOf('sitzung/')>-1){
    var t=location.hash.split('/')[1];
    if(t==='pendenzen'||t==='archiv'||t==='sitzung') BLATT=t;
  }
  laden();
  window.addEventListener('online', function(){ netzOk=true; nachschieben(); fussZeichnen(); });
  window.addEventListener('offline',function(){ netzOk=false; fussZeichnen(); });
}

function laden(){
  Promise.all([
    hole(P_SITZ), hole(P_PEND),
    fetch('uploads/tables/baustand.json?_='+Date.now(),{cache:'no-store'})
      .then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }),
    fetch('uploads/tables/bohrstand.json?_='+Date.now(),{cache:'no-store'})
      .then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }),
    hole(P_VM)
  ]).then(function(a){
    SITZUNGEN=a[0]||{}; PUEBER=a[1]||{};
    LIVE=zahlenRechnen(a[2],a[3],a[4]);
    offeneUebernehmen();
    if(!AKTIV) AKTIV=jungsteOffene()||naechsterTermin();
    zeichnen();
  });
}

function hole(pfad){
  return fetch(DB+'/'+pfad+'.json?_='+Date.now(),{cache:'no-store'})
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(j){ netzOk=true; return j; })
    .catch(function(){ netzOk=false; return null; });
}

/* Sätze, die offline geschrieben wurden, in den geladenen Stand mischen –
   sonst überschreibt ein Neuladen die Arbeit, die noch nicht gespiegelt ist. */
function offeneUebernehmen(){
  var offen=lsOffen();
  for(var d in offen.sitzungen){
    var lok=offen.sitzungen[d], fb=SITZUNGEN[d];
    if(!fb || (lok.geaendert||0) >= (fb.geaendert||0)) SITZUNGEN[d]=lok;
  }
  for(var p in offen.pendenzen){
    var lp=offen.pendenzen[p], fp=PUEBER[p];
    if(!fp || (lp.ts||0) >= (fp.ts||0)) PUEBER[p]=lp;
  }
  nachschieben();
}

function jungsteOffene(){
  var d=Object.keys(SITZUNGEN).filter(function(k){
    return SITZUNGEN[k] && SITZUNGEN[k].status!=='abgeschlossen'; }).sort();
  return d.length?d[d.length-1]:null;
}

/* ═══════════════════════════════════════════════════════════
   Zahlen aus den Projektdaten – niemand tippt sie ab
   ═══════════════════════════════════════════════════════════ */
function zahlenRechnen(baustand, bohrstand, vm){
  var z={ stand:'', bohr:null, tische:null, woche:null, vormontiert:0 };
  if(bohrstand && bohrstand.summe){
    /* summe zählt je Stufe; wer injiziert ist, war vorher gebohrt –
       deshalb von hinten aufsummieren. */
    var s=bohrstand.summe;
    var inj=s['Injiziert']||0, ver=inj+(s['Vermessen']||0), geb=ver+(s['Gebohrt']||0);
    var abg=geb+(s['Abgesteckt']||0), tot=abg+(s['Geplant']||0);
    z.bohr={ total:tot, abgesteckt:abg, gebohrt:geb, vermessen:ver, injiziert:inj,
             offenInj:geb-inj, offenVerm:geb-ver };
    z.stand=bohrstand.stand||'';
  }
  if(baustand && baustand.tische){
    var pk=0,mt=0,vs=0, wPk=0,wMt=0,wVs=0, vPk=0,vMt=0;
    var jetzt=new Date(), kwJetzt=kw(jetzt), kwVor=kw(new Date(jetzt.getTime()-7*86400000));
    for(var id in baustand.tische){
      var t=baustand.tische[id];
      if(t.pk){ pk++; var k=kw(new Date(t.pk+'T12:00:00')); if(k===kwJetzt) wPk++; if(k===kwVor) vPk++; }
      if(t.mt){ mt++; var k2=kw(new Date(t.mt+'T12:00:00')); if(k2===kwJetzt) wMt++; if(k2===kwVor) vMt++; }
      if(t.vs){ vs++; var k3=kw(new Date(t.vs+'T12:00:00')); if(k3===kwJetzt) wVs++; }
    }
    z.tische={ pk:pk, mt:mt, verschraubt:vs, ohneMt:pk-mt };
    z.woche={ kw:kwJetzt, kwVor:kwVor, pk:wPk, mt:wMt, vs:wVs, vorPk:vPk, vorMt:vMt };
    if(baustand.stand) z.stand=baustand.stand;
  }
  if(vm){
    var tische={};
    for(var k4 in vm){ var f=vm[k4];
      if(f && f.art==='vormontiert' && f.tischId) tische[f.tischId]=1; }
    z.vormontiert=Object.keys(tische).length;
  }
  return z;
}

/* ═══════════════════════════════════════════════════════════
   Sitzungssatz
   ═══════════════════════════════════════════════════════════ */
function neueSitzung(datum){
  var d=new Date(datum+'T12:00:00');
  var s={ datum:datum, zeit:'11:00', ort:'Container Berg', leitung:'Victor Malt',
          protokoll: wer()||'Victor Malt', status:'laeuft',
          schwerpunkt: SCHWERPUNKT[d.getDay()]||'', teilnehmer:{}, gaeste:'',
          reden:['','','','',''], lob:'', boxen:{}, parkplatz:[], pendenzen:[],
          abgleich:{}, zahlen: LIVE?JSON.parse(JSON.stringify(LIVE)):null,
          angelegt:Date.now(), geaendert:Date.now(), von:wer() };
  RUNDE.forEach(function(p){ s.teilnehmer[p.id]= p.fest?'da':'?'; });
  ABLAUF.forEach(function(b){ s.boxen[b.id]={ text:'', gebraucht:0 }; });
  return s;
}
function sitz(){ return AKTIV?SITZUNGEN[AKTIV]:null; }

/* Alle Pendenzen aller Sitzungen, mit Statusüberlagerung. */
function allePendenzen(){
  var out=[];
  Object.keys(SITZUNGEN).sort().forEach(function(d){
    var s=SITZUNGEN[d]; if(!s||!s.pendenzen) return;
    s.pendenzen.forEach(function(p){
      var k={}; for(var f in p) k[f]=p[f];
      k.sitzung=d;
      var u=PUEBER[p.id];
      if(u){ if(u.status) k.status=u.status; if(u.bemerkung) k.bemerkung=u.bemerkung;
             k.geaendert=u.ts; k.geaendertVon=u.von; }
      out.push(k);
    });
  });
  return out;
}
/* Pendenzen fuers Protokoll: die eigenen kommen direkt aus dem Satz (der kann
   frisch sein und noch nicht in SITZUNGEN stehen), dazu alles, was aus frueheren
   Sitzungen offen geblieben ist. */
function pendenzenFuer(s){
  var eigen=(s.pendenzen||[]).map(function(p){
    var k={}; for(var f in p) k[f]=p[f];
    k.sitzung=s.datum;
    var u=PUEBER[p.id];
    if(u){ if(u.status) k.status=u.status; if(u.bemerkung) k.bemerkung=u.bemerkung; }
    return k;
  });
  var ids={}; eigen.forEach(function(p){ ids[p.id]=1; });
  var fremd=allePendenzen().filter(function(p){
    return !ids[p.id] && p.sitzung!==s.datum && p.status!=='erledigt'; });
  return eigen.concat(fremd).sort(function(a,b){
    return (a.bis||'9999').localeCompare(b.bis||'9999'); });
}

function offenePendenzenVor(datum){
  return allePendenzen().filter(function(p){
    return p.sitzung<datum && p.status!=='erledigt'; });
}

/* ═══════════════════════════════════════════════════════════
   Speichern – erst lokal, dann RTDB
   ═══════════════════════════════════════════════════════════ */
function lsOffen(){
  try { var o=JSON.parse(localStorage.getItem(LS_OFF)||'{}');
        return { sitzungen:o.sitzungen||{}, pendenzen:o.pendenzen||{} }; }
  catch(e){ return { sitzungen:{}, pendenzen:{} }; }
}
function lsSchreiben(o){ try { localStorage.setItem(LS_OFF,JSON.stringify(o)); } catch(e){} }

function merken(){
  var s=sitz(); if(!s) return;
  s.geaendert=Date.now(); s.von=wer();
  var o=lsOffen(); o.sitzungen[s.datum]=s; lsSchreiben(o);
  fussZeichnen();
  clearTimeout(speicherWartet);
  speicherWartet=setTimeout(spiegeln,1200);
}
function pendMerken(id, satz){
  PUEBER[id]=satz;
  var o=lsOffen(); o.pendenzen[id]=satz; lsSchreiben(o);
  fussZeichnen();
  clearTimeout(speicherWartet);
  speicherWartet=setTimeout(spiegeln,1200);
}

function spiegeln(){
  var o=lsOffen(), aufgaben=[];
  Object.keys(o.sitzungen).forEach(function(d){
    aufgaben.push(fetch(DB+'/'+P_SITZ+'/'+d+'.json',{ method:'PUT',
      body:JSON.stringify(o.sitzungen[d]) }).then(function(r){
        if(r.ok){ var n=lsOffen(); delete n.sitzungen[d]; lsSchreiben(n); } }));
  });
  Object.keys(o.pendenzen).forEach(function(p){
    aufgaben.push(fetch(DB+'/'+P_PEND+'/'+p+'.json',{ method:'PUT',
      body:JSON.stringify(o.pendenzen[p]) }).then(function(r){
        if(r.ok){ var n=lsOffen(); delete n.pendenzen[p]; lsSchreiben(n); } }));
  });
  if(!aufgaben.length){ netzOk=true; fussZeichnen(); return; }
  Promise.all(aufgaben).then(function(){ netzOk=true; fussZeichnen(); })
    .catch(function(){ netzOk=false; fussZeichnen(); });
}
function nachschieben(){ var o=lsOffen();
  if(Object.keys(o.sitzungen).length||Object.keys(o.pendenzen).length) spiegeln(); }

/* ═══════════════════════════════════════════════════════════
   Zeichnen – Rahmen
   ═══════════════════════════════════════════════════════════ */
function zeichnen(){
  navZeichnen();
  if(BLATT==='pendenzen') pendenzBlatt();
  else if(BLATT==='archiv') archivBlatt();
  else sitzungBlatt();
  /* Nur wenn der Reiter wirklich offen ist – beim Seitenstart laeuft der
     Baustein auch im versteckten Reiter (fuer den Zaehler), und dann darf er
     den Hash eines anderen Reiters nicht ueberschreiben. */
  if(sichtbar()){ try { location.hash='sitzung/'+BLATT; } catch(e){} }
}
function sichtbar(){ return !!(ZIEL && ZIEL.classList && ZIEL.classList.contains('an')); }
function navZeichnen(){
  var offen=allePendenzen().filter(function(p){ return p.status!=='erledigt'; }).length;
  var b=[{id:'sitzung',n:'Sitzung führen',z:0},
         {id:'pendenzen',n:'Pendenzen',z:offen},
         {id:'archiv',n:'Archiv',z:0}];
  $('siNav').innerHTML=b.map(function(x){
    return '<button data-sb="'+x.id+'"'+(BLATT===x.id?' class="on"':'')+'>'+x.n
      +(x.z?' <i>'+x.z+'</i>':'')+'</button>'; }).join('');
  Array.prototype.forEach.call($('siNav').querySelectorAll('button'),function(k){
    k.onclick=function(){ BLATT=k.getAttribute('data-sb'); zeichnen(); window.scrollTo(0,0); };
  });
  var zahl=document.getElementById('zSitz');
  if(zahl) zahl.textContent=offen||'–';
}

/* ═══════════════════════════════════════════════════════════
   BLATT 1 – Sitzung führen
   ═══════════════════════════════════════════════════════════ */
function sitzungBlatt(){
  var s=sitz();
  if(!s){ auswahlZeigen(); return; }
  var d=new Date(s.datum+'T12:00:00');
  var geplant=ABLAUF.reduce(function(a,b){ return a+b.dauer; },0);

  var html='';
  /* Kopf */
  html+='<div class="si-kopf">'
    +'<h2>Koordinationssitzung BF / PL</h2>'
    +'<div class="wann">'+wochentag(s.datum)+' '+deDat(s.datum)+' · '+h(s.zeit)+'–'
      +h(endzeit(s.zeit,geplant))+' · '+h(s.ort)
      +(s.schwerpunkt?' · <span style="color:#D72622">'+h(s.schwerpunkt)+'</span>':'')+'</div>'
    +'<div class="si-feld">'
      +'<div><label>Datum</label><input type="date" id="siDatum" value="'+h(s.datum)+'"></div>'
      +'<div><label>Beginn</label><input type="time" id="siZeit" value="'+h(s.zeit)+'" style="width:110px"></div>'
      +'<div><label>Ort</label><input id="siOrt" value="'+h(s.ort)+'" style="width:160px"></div>'
      +'<div><label>Protokoll</label><input id="siProt" value="'+h(s.protokoll)+'" style="width:150px"></div>'
    +'</div>'
    +'<label style="display:block;font-size:11px;color:#63676d;font-weight:700;margin:8px 0 3px">'
      +'Anwesend – antippen wechselt da / fehlt</label>'
    +'<div class="si-runde" id="siRunde"></div>'
    +'<div class="si-feld" style="margin-top:8px"><div style="flex:1 1 240px">'
      +'<label>Weitere Teilnehmer (Gäste)</label>'
      +'<input id="siGaeste" value="'+h(s.gaeste||'')+'" style="width:100%" '
      +'placeholder="z. B. Kamil, Przemek (Verschrauben)"></div></div>'
    +'</div>';

  /* Uhr */
  html+='<div class="si-uhr" id="siUhr"></div>';

  /* Zahlen */
  html+=zahlenBlock(s);

  /* Darüber müssen wir heute reden */
  html+='<div class="si-reden"><h3>Darüber müssen wir heute reden</h3>'
    +'<div class="sub">Höchstens fünf Punkte. Alles andere ist Information – die wird gelesen, '
    +'nicht besprochen.</div><div id="siReden"></div></div>';

  /* Abgleich zur letzten Sitzung */
  html+=abgleichBlock(s);

  /* Ablaufboxen */
  html+='<div id="siBoxen"></div>';

  /* Parkplatz */
  html+='<div class="si-park"><h3>🅿 Parkplatz</h3>'
    +'<div class="sub">Was nicht in die laufende Box gehört, kommt hierhin – mit Namen. '
    +'«Ich nehm das auf den Parkplatz, es geht nicht verloren.» Am Schluss bekommt jeder Punkt '
    +'eine Erledigung: jetzt besprochen · Pendenz · eigener Termin.</div>'
    +'<ul id="siPark"></ul>'
    +'<div class="si-neu">'
      +'<div class="was"><label>Punkt</label><input id="siParkText" placeholder="Worum geht es?"></div>'
      +'<div><label>Von wem</label><input id="siParkVon" style="width:130px" placeholder="Name"></div>'
      +'<div><button class="si-kn" id="siParkAdd">+ auf den Parkplatz</button></div>'
    +'</div></div>';

  /* Pendenzen dieser Sitzung */
  html+='<div class="si-kopf" style="border-left-color:#14181d">'
    +'<h2>Pendenzen aus dieser Sitzung</h2>'
    +'<div class="sub" style="font-size:11.5px;color:#63676d;margin-bottom:9px;line-height:1.5">'
    +'Kein Punkt ohne Namen und Datum – ohne beides lässt sich hier nichts speichern.</div>'
    +'<div id="siPend"></div>'
    +'<div class="si-neu">'
      +'<div class="was"><label>Was ist zu tun</label><input id="siPnWas" placeholder="Konkrete Handlung"></div>'
      +'<div><label>Wer</label><input id="siPnWer" style="width:130px" placeholder="Name"></div>'
      +'<div><label>Bis wann</label><input type="date" id="siPnBis" style="width:150px"></div>'
      +'<div><button class="si-kn rot" id="siPnAdd">+ Pendenz</button></div>'
      +'<div class="wrn" id="siPnWrn"></div>'
    +'</div></div>';

  /* Lob */
  html+='<div class="si-lob"><h3>Was gut läuft</h3>'
    +'<div class="sub">Gehört ins Protokoll. Eine Sitzung, die nur Probleme aufzählt, '
    +'zieht die Runde runter.</div>'
    +'<textarea id="siLob" placeholder="…">'+h(s.lob||'')+'</textarea></div>';

  /* Abschluss */
  html+='<div class="si-kopf">'
    +'<h2>Protokoll abschliessen</h2>'
    +'<div class="sub" style="font-size:11.5px;color:#63676d;margin-bottom:9px;line-height:1.5">'
    +'Druckansicht öffnet das fertige Protokoll in einem neuen Fenster – von dort mit '
    +'Strg+P als PDF speichern und an den Verteiler schicken.</div>'
    +'<button class="si-kn dunkel" id="siDruck">🖨 Druckansicht / PDF</button> '
    +'<button class="si-kn" id="siText">📋 Als Text kopieren</button> '
    +'<button class="si-kn '+(s.status==='abgeschlossen'?'':'gruen')+'" id="siFertig">'
      +(s.status==='abgeschlossen'?'↩ wieder öffnen':'✓ Sitzung abschliessen')+'</button>'
    +'<div id="siFertigMsg" style="font-size:12.5px;color:#63676d;margin-top:8px"></div>'
    +'</div>';

  /* Fusszeile mit Schnellparkplatz */
  html+='<div class="si-fuss" id="siFuss"></div>';

  $('siInhalt').innerHTML=html;
  kopfBinden(); rundeZeichnen(); redenZeichnen(); boxenZeichnen();
  parkZeichnen(); pendZeichnen(); abgleichBinden(); uhrZeichnen(); fussZeichnen();

  $('siLob').oninput=function(){ s.lob=this.value; merken(); };
  $('siDruck').onclick=drucken;
  $('siText').onclick=alsTextKopieren;
  $('siFertig').onclick=abschliessen;
  $('siParkAdd').onclick=parkHinzu;
  $('siParkText').onkeydown=function(e){ if(e.key==='Enter') parkHinzu(); };
  $('siPnAdd').onclick=pendHinzu;
  $('siPnWas').onkeydown=function(e){ if(e.key==='Enter') pendHinzu(); };
}

function endzeit(zeit,minuten){
  var t=(zeit||'11:00').split(':'); var m=(+t[0])*60+(+t[1])+minuten;
  return z2(Math.floor(m/60)%24)+':'+z2(m%60);
}

function auswahlZeigen(){
  var offen=jungsteOffene();
  $('siInhalt').innerHTML='<div class="si-kopf"><h2>Koordinationssitzung</h2>'
    +'<div class="sub" style="font-size:12.5px;color:#63676d;line-height:1.6;margin-bottom:10px">'
    +'Es ist keine Sitzung offen. Die nächste ist '+wochentag(naechsterTermin())+' '
    +deDat(naechsterTermin())+'.</div>'
    +'<button class="si-kn rot" id="siNeu">+ Sitzung '+deDat(naechsterTermin())+' anlegen</button>'
    +(offen?' <button class="si-kn" id="siWeiter">weiter mit '+deDat(offen)+'</button>':'')
    +'</div>';
  $('siNeu').onclick=function(){
    var d=naechsterTermin();
    if(!SITZUNGEN[d]) SITZUNGEN[d]=neueSitzung(d);
    AKTIV=d; merken(); zeichnen();
  };
  if(offen) $('siWeiter').onclick=function(){ AKTIV=offen; zeichnen(); };
}

function kopfBinden(){
  var s=sitz();
  $('siDatum').onchange=function(){
    var neu=this.value; if(!neu||neu===s.datum) return;
    if(SITZUNGEN[neu] && !confirm('Für den '+deDat(neu)+' gibt es schon eine Sitzung. Diese öffnen?')){
      this.value=s.datum; return; }
    if(SITZUNGEN[neu]){ AKTIV=neu; zeichnen(); return; }
    delete SITZUNGEN[s.datum]; s.datum=neu;
    var d=new Date(neu+'T12:00:00'); s.schwerpunkt=SCHWERPUNKT[d.getDay()]||'';
    SITZUNGEN[neu]=s; AKTIV=neu; merken(); zeichnen();
  };
  $('siZeit').onchange =function(){ s.zeit=this.value; merken(); zeichnen(); };
  $('siOrt').oninput   =function(){ s.ort=this.value; merken(); };
  $('siProt').oninput  =function(){ s.protokoll=this.value; werSetzen(this.value); merken(); };
  $('siGaeste').oninput=function(){ s.gaeste=this.value; merken(); };
}

function rundeZeichnen(){
  var s=sitz();
  $('siRunde').innerHTML=RUNDE.map(function(p){
    var st=s.teilnehmer[p.id]||'?';
    var kl=st==='da'?'da':(st==='fehlt'?'fehlt':'');
    return '<span class="si-pers '+kl+'" data-p="'+p.id+'" title="'+h(p.rolle)+'">'
      +h(p.name.split(' ')[0])+' '+h(p.name.split(' ').slice(1).join(' '))+'</span>';
  }).join('');
  Array.prototype.forEach.call($('siRunde').querySelectorAll('.si-pers'),function(el){
    el.onclick=function(){
      var id=el.getAttribute('data-p'), st=s.teilnehmer[id]||'?';
      s.teilnehmer[id]= st==='da'?'fehlt':'da';
      merken(); rundeZeichnen();
    };
  });
}

function redenZeichnen(){
  var s=sitz();
  if(!s.reden) s.reden=['','','','',''];
  $('siReden').innerHTML=s.reden.map(function(t,i){
    return '<div class="zeile"><span class="nr">'+(i+1)+'</span>'
      +'<input data-r="'+i+'" value="'+h(t)+'" placeholder="'
      +(i===0?'Der Punkt, der heute wirklich entschieden werden muss':'…')+'"></div>';
  }).join('');
  Array.prototype.forEach.call($('siReden').querySelectorAll('input'),function(el){
    el.oninput=function(){ s.reden[+el.getAttribute('data-r')]=el.value; merken(); };
  });
}

function zahlenBlock(s){
  var z=s.zahlen||LIVE; if(!z) return '';
  var k='';
  if(z.bohr) k+='<div><b>'+z.bohr.gebohrt.toLocaleString('de-CH')+'</b>'
    +'<span>gebohrt von '+z.bohr.total.toLocaleString('de-CH')+'</span></div>'
    +'<div><b>'+z.bohr.injiziert.toLocaleString('de-CH')+'</b><span>injiziert</span></div>'
    +'<div style="border-top-color:'+(z.bohr.offenInj>250?'#D72622':'#e08a00')+'"><b>'
      +z.bohr.offenInj.toLocaleString('de-CH')+'</b><span>gebohrt, nicht injiziert</span></div>'
    +'<div style="border-top-color:'+(z.bohr.offenVerm>100?'#D72622':'#e08a00')+'"><b>'
      +z.bohr.offenVerm.toLocaleString('de-CH')+'</b><span>gebohrt, nicht vermessen</span></div>';
  if(z.tische) k+='<div><b>'+z.tische.pk+'</b><span>Primärkonstruktion</span></div>'
    +'<div><b>'+z.tische.mt+'</b><span>Modulträger</span></div>'
    +'<div><b>'+z.vormontiert+'</b><span>vormontiert (App)</span></div>'
    +'<div><b>'+z.tische.verschraubt+'</b><span>verschraubt (Nalpi)</span></div>';
  var w='';
  if(z.woche) w='<div class="si-hin" style="margin-bottom:0">'
    +'<b>Leistung KW'+z.woche.kw+' (laufend):</b> '+z.woche.pk+' PK · '+z.woche.mt+' Modulträger'
    +(z.woche.vs?' · '+z.woche.vs+' verschraubt':'')
    +' &nbsp;|&nbsp; <b>KW'+z.woche.kwVor+':</b> '+z.woche.vorPk+' PK · '+z.woche.vorMt+' Modulträger'
    +'<br>Datenstand '+h(deDat(z.stand||''))+' (Nalpi-Automatik) · Vormontage und Verschrauben '
    +'aus der Website-Datenbank. <b>Zahlen werden vorgelesen, nicht diskutiert</b> – '
    +'wer eine anzweifelt, macht daraus eine Pendenz.</div>';
  return '<div class="si-kach">'+k+'</div>'+w;
}

/* ── Abgleich zur letzten Sitzung ── */
function abgleichBlock(s){
  var offen=offenePendenzenVor(s.datum);
  if(!offen.length) return '';
  var r=offen.map(function(p){
    var st=PSTATUS.filter(function(x){ return x.id===(p.status||'offen'); })[0]||PSTATUS[0];
    return '<tr><td>'+h(p.was)+'<div style="font-size:11px;color:#63676d">aus '+deDat(p.sitzung)
      +(p.bemerkung?' · '+h(p.bemerkung):'')+'</div></td>'
      +'<td style="white-space:nowrap">'+h(p.wer||'?')+'</td>'
      +'<td style="white-space:nowrap">'+deDat(p.bis||'')+'</td>'
      +'<td style="background:'+st.f+'">'+PSTATUS.map(function(x){
          return '<button class="si-kn mini'+(x.id===st.id?' rot':'')+'" data-ab="'+p.id
            +'" data-st="'+x.id+'">'+x.n+'</button>'; }).join(' ')+'</td></tr>';
  }).join('');
  return '<div class="si-kopf" style="border-left-color:#1a5fb4">'
    +'<h2>Abgleich zur letzten Sitzung</h2>'
    +'<div class="sub" style="font-size:11.5px;color:#63676d;margin-bottom:9px;line-height:1.5">'
    +'Jeder offene Punkt der Vorsitzungen wird aufgegriffen – auch der, der nur bestätigt wird. '
    +'Vor der Sitzung durchgehen, dann muss die Runde nicht darüber diskutieren.</div>'
    +'<div style="overflow-x:auto"><table class="si-tab"><thead><tr><th>Punkt</th><th>Wer</th>'
    +'<th>Bis</th><th>Stand heute</th></tr></thead><tbody>'+r+'</tbody></table></div></div>';
}
function abgleichBinden(){
  Array.prototype.forEach.call(document.querySelectorAll('[data-ab]'),function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-ab'), st=b.getAttribute('data-st');
      pendMerken(id,{ status:st, bemerkung:(PUEBER[id]||{}).bemerkung||'',
                      ts:Date.now(), von:wer(), sitzung:AKTIV });
      zeichnen();
    };
  });
}

/* ── Ablaufboxen mit Timebox ── */
function boxenZeichnen(){
  var s=sitz();
  $('siBoxen').innerHTML=ABLAUF.map(function(b){
    var d=s.boxen[b.id]||{text:'',gebraucht:0};
    var soll=b.dauer*60, hat=d.gebraucht||0;
    var kl= hat>soll?'ueber':(hat>0?'fertig':'');
    var laeuft=TIMER.box===b.id;
    return '<div class="si-box'+(laeuft?' laeuft':'')+'" data-box="'+b.id+'">'
      +'<div class="k" data-uhr="'+b.id+'"><b>'+h(b.titel)+'</b>'
        +'<span class="min '+kl+'" id="siMin-'+b.id+'">'+mmss(hat)+' / '+b.dauer+':00</span>'
        +'<button class="si-kn mini '+(laeuft?'rot':'')+'" data-timer="'+b.id+'">'
          +(laeuft?'⏸ Stopp':'▶ '+b.dauer+' Min')+'</button></div>'
      +'<div class="inn">'
        +'<div class="hilfe">'+h(b.hilfe)+'</div>'
        +'<textarea data-txt="'+b.id+'" placeholder="Stichworte – kurze Zeilen, keine Absätze">'
          +h(d.text||'')+'</textarea>'
        +'<div class="zeilen">'
          +'<button class="si-kn mini" data-mik="'+b.id+'">🎤 Diktieren</button>'
          +'<button class="si-kn mini" data-daraus="'+b.id+'">→ Pendenz daraus</button>'
        +'</div>'
      +'</div></div>';
  }).join('');

  Array.prototype.forEach.call($('siBoxen').querySelectorAll('[data-txt]'),function(el){
    el.oninput=function(){
      var id=el.getAttribute('data-txt');
      if(!s.boxen[id]) s.boxen[id]={text:'',gebraucht:0};
      s.boxen[id].text=el.value; merken();
    };
  });
  Array.prototype.forEach.call($('siBoxen').querySelectorAll('[data-timer]'),function(b){
    b.onclick=function(e){ e.stopPropagation(); timerUm(b.getAttribute('data-timer')); };
  });
  Array.prototype.forEach.call($('siBoxen').querySelectorAll('[data-daraus]'),function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-daraus');
      var t=(s.boxen[id]&&s.boxen[id].text||'').split('\n').filter(function(x){ return x.trim(); });
      $('siPnWas').value=t.length?t[t.length-1].replace(/^[-•*\s]+/,''):'';
      $('siPnWas').focus();
      $('siPnWas').scrollIntoView({behavior:'smooth',block:'center'});
    };
  });
  mikBinden();
}
function mmss(sek){ sek=Math.max(0,Math.round(sek)); return z2(Math.floor(sek/60))+':'+z2(sek%60); }

/* ── Timer: nur eine Box läuft, Ton bei Ablauf ── */
function timerUm(id){
  if(TIMER.box===id){ timerStopp(); }
  else { if(TIMER.box) timerStopp(); TIMER.box=id; TIMER.start=Date.now();
         TIMER.tick=setInterval(timerTick,1000); }
  boxenZeichnen(); uhrZeichnen();
}
function timerStopp(){
  if(!TIMER.box) return;
  var s=sitz(); var id=TIMER.box;
  if(s){ if(!s.boxen[id]) s.boxen[id]={text:'',gebraucht:0};
         s.boxen[id].gebraucht=(s.boxen[id].gebraucht||0)+Math.round((Date.now()-TIMER.start)/1000);
         merken(); }
  clearInterval(TIMER.tick); TIMER.box=null; TIMER.tick=null;
}
var tonGegeben={};
function timerTick(){
  var s=sitz(); if(!s||!TIMER.box) return;
  var b=ABLAUF.filter(function(x){ return x.id===TIMER.box; })[0];
  var hat=(s.boxen[TIMER.box].gebraucht||0)+Math.round((Date.now()-TIMER.start)/1000);
  var el=$('siMin-'+TIMER.box);
  if(el){ el.textContent=mmss(hat)+' / '+b.dauer+':00';
          el.className='min '+(hat>b.dauer*60?'ueber':'fertig'); }
  if(hat>b.dauer*60 && !tonGegeben[TIMER.box]){ tonGegeben[TIMER.box]=true; piep(); }
  uhrZeichnen(hat);
}
function piep(){
  try {
    var C=window.AudioContext||window.webkitAudioContext; if(!C) return;
    var a=new C(), o=a.createOscillator(), g=a.createGain();
    o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(a.destination);
    g.gain.setValueAtTime(.001,a.currentTime);
    g.gain.exponentialRampToValueAtTime(.25,a.currentTime+.02);
    g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.6);
    o.start(); o.stop(a.currentTime+.62);
  } catch(e){}
}

function uhrZeichnen(laufendSek){
  var s=sitz(), el=$('siUhr'); if(!s||!el) return;
  var geplant=ABLAUF.reduce(function(a,b){ return a+b.dauer*60; },0);
  var gebraucht=ABLAUF.reduce(function(a,b){ return a+((s.boxen[b.id]||{}).gebraucht||0); },0);
  if(TIMER.box && laufendSek!=null) gebraucht+=Math.round((Date.now()-TIMER.start)/1000);
  var box=TIMER.box?ABLAUF.filter(function(x){ return x.id===TIMER.box; })[0]:null;
  var anteil=Math.min(100,Math.round(gebraucht/geplant*100));
  var kl= gebraucht>geplant?'ueber':(gebraucht>geplant*.85?'warn':'');
  var jetzt=box? mmss(((s.boxen[box.id]||{}).gebraucht||0)+Math.round((Date.now()-TIMER.start)/1000))
               : mmss(gebraucht);
  el.className='si-uhr '+kl;
  el.innerHTML='<span class="gr">'+jetzt+'</span>'
    +'<span class="wo">'+(box? h(box.titel)+' · '+box.dauer+' Minuten angesagt'
        : 'Sitzung gesamt · '+Math.round(gebraucht/60)+' von 60 Minuten')+'</span>'
    +(box?'<button class="si-kn mini rot" id="siUhrStopp">⏸ Stopp</button>':'')
    +'<span class="bal"><i style="width:'+anteil+'%"></i></span>';
  if(box) $('siUhrStopp').onclick=function(){ timerStopp(); boxenZeichnen(); uhrZeichnen(); };
}

/* ── Parkplatz ── */
function parkHinzu(){
  var s=sitz(), t=$('siParkText').value.trim();
  if(!t) return;
  var von=$('siParkVon').value.trim()||'';
  if(!s.parkplatz) s.parkplatz=[];
  s.parkplatz.push({ id:neueId(), text:t, von:von, erledigung:'', ts:Date.now() });
  $('siParkText').value='';
  merken(); parkZeichnen(); fussZeichnen();
}
function parkZeichnen(){
  var s=sitz(), el=$('siPark'); if(!el) return;
  var l=s.parkplatz||[];
  if(!l.length){ el.innerHTML='<div class="si-leer">Noch nichts auf dem Parkplatz.</div>'; return; }
  el.innerHTML=l.map(function(p){
    var wahl=[['besprochen','jetzt besprochen'],['pendenz','→ Pendenz'],['termin','eigener Termin']];
    return '<li'+(p.erledigung?' class="erl"':'')+'>'
      +'<div>'+h(p.text)+(p.von?' <span class="von">· '+h(p.von)+'</span>':'')+'</div>'
      +'<div class="wahl">'+wahl.map(function(w){
          return '<button class="si-kn mini'+(p.erledigung===w[0]?' rot':'')+'" data-pk="'+p.id
            +'" data-e="'+w[0]+'">'+w[1]+'</button>'; }).join('')
        +'<button class="si-kn mini" data-pkdel="'+p.id+'">✕</button></div></li>';
  }).join('');
  Array.prototype.forEach.call(el.querySelectorAll('[data-pk]'),function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-pk'), e=b.getAttribute('data-e');
      var p=(s.parkplatz||[]).filter(function(x){ return x.id===id; })[0]; if(!p) return;
      p.erledigung=(p.erledigung===e)?'':e;
      if(e==='pendenz' && p.erledigung==='pendenz'){
        $('siPnWas').value=p.text; $('siPnWer').value=p.von||'';
        $('siPnWas').scrollIntoView({behavior:'smooth',block:'center'}); $('siPnWer').focus();
      }
      merken(); parkZeichnen();
    };
  });
  Array.prototype.forEach.call(el.querySelectorAll('[data-pkdel]'),function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-pkdel');
      s.parkplatz=(s.parkplatz||[]).filter(function(x){ return x.id!==id; });
      merken(); parkZeichnen(); fussZeichnen();
    };
  });
}

/* ── Pendenzen der laufenden Sitzung ── */
function pendHinzu(){
  var s=sitz();
  var was=$('siPnWas').value.trim(), w=$('siPnWer').value.trim(), bis=$('siPnBis').value;
  var fehlt=[];
  if(!was) fehlt.push('was zu tun ist');
  if(!w)   fehlt.push('wer');
  if(!bis) fehlt.push('bis wann');
  if(fehlt.length){ $('siPnWrn').textContent='Fehlt noch: '+fehlt.join(' · ')
    +' – kein Punkt ohne Namen und Datum.'; return; }
  $('siPnWrn').textContent='';
  if(!s.pendenzen) s.pendenzen=[];
  s.pendenzen.push({ id:neueId(), was:was, wer:w, bis:bis, status:'offen', ts:Date.now() });
  $('siPnWas').value=''; $('siPnWer').value='';
  merken(); pendZeichnen(); navZeichnen();
}
function pendZeichnen(){
  var s=sitz(), el=$('siPend'); if(!el) return;
  var l=s.pendenzen||[];
  if(!l.length){ el.innerHTML='<div class="si-leer">Noch keine Pendenz erfasst.</div>'; return; }
  el.innerHTML='<div style="overflow-x:auto"><table class="si-tab"><thead><tr>'
    +'<th>Was</th><th>Wer</th><th>Bis</th><th></th></tr></thead><tbody>'
    +l.map(function(p){
      var u=PUEBER[p.id]||{}; var st=u.status||p.status||'offen';
      var f=(PSTATUS.filter(function(x){ return x.id===st; })[0]||PSTATUS[0]).f;
      return '<tr style="background:'+f+'"><td>'+h(p.was)+'</td>'
        +'<td style="white-space:nowrap">'+h(p.wer)+'</td>'
        +'<td style="white-space:nowrap">'+deDat(p.bis)+'</td>'
        +'<td style="white-space:nowrap"><button class="si-kn mini" data-pndel="'+p.id+'">✕</button></td></tr>';
    }).join('')+'</tbody></table></div>';
  Array.prototype.forEach.call(el.querySelectorAll('[data-pndel]'),function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-pndel');
      if(!confirm('Pendenz löschen?')) return;
      s.pendenzen=(s.pendenzen||[]).filter(function(x){ return x.id!==id; });
      merken(); pendZeichnen(); navZeichnen();
    };
  });
}

/* ── Fusszeile: Stand + Schnellerfassung Parkplatz ── */
function fussZeichnen(){
  var el=$('siFuss'); if(!el) return;
  var o=lsOffen();
  var warten=Object.keys(o.sitzungen).length+Object.keys(o.pendenzen).length;
  var s=sitz();
  var park=s?(s.parkplatz||[]).filter(function(p){ return !p.erledigung; }).length:0;
  el.innerHTML='<span class="st'+(warten?' off':'')+'">'
      +(warten? '⏳ '+warten+' Änderung(en) warten aufs Netz' : '✓ gespeichert')
      +(park? ' · '+park+' offen auf dem Parkplatz':'')+'</span>'
    +'<input id="siFussPark" placeholder="🅿 schnell auf den Parkplatz – Enter">'
    +'<button class="si-kn mini" id="siFussSave">Speichern</button>';
  $('siFussPark').onkeydown=function(e){
    if(e.key!=='Enter') return;
    var t=this.value.trim(); if(!t) return;
    var s2=sitz(); if(!s2.parkplatz) s2.parkplatz=[];
    s2.parkplatz.push({ id:neueId(), text:t, von:'', erledigung:'', ts:Date.now() });
    this.value=''; merken(); parkZeichnen(); fussZeichnen();
  };
  $('siFussSave').onclick=function(){ spiegeln(); };
}

/* ── Diktieren (Chrome/Edge) ── */
function mikBinden(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  Array.prototype.forEach.call(document.querySelectorAll('[data-mik]'),function(b){
    if(!SR){ b.style.display='none'; return; }
    var id=b.getAttribute('data-mik');
    var feld=document.querySelector('[data-txt="'+id+'"]');
    var erk=null, laeuft=false;
    b.onclick=function(){
      if(laeuft){ try{ erk.stop(); }catch(e){} return; }
      erk=new SR(); erk.lang='de-CH'; erk.continuous=true; erk.interimResults=true;
      var start=feld.value, zwischen='';
      erk.onstart=function(){ laeuft=true; b.classList.add('hoert'); b.textContent='⏹ Stopp'; };
      erk.onresult=function(ev){
        var fest='',vorl='';
        for(var i=ev.resultIndex;i<ev.results.length;i++){
          if(ev.results[i].isFinal) fest+=ev.results[i][0].transcript;
          else vorl+=ev.results[i][0].transcript;
        }
        if(fest) zwischen+=(zwischen?'\n':'')+fest;
        feld.value=(start?start+'\n':'')+zwischen+vorl;
      };
      erk.onend=function(){ laeuft=false; b.classList.remove('hoert'); b.textContent='🎤 Diktieren';
        var s=sitz(); if(!s.boxen[id]) s.boxen[id]={text:'',gebraucht:0};
        s.boxen[id].text=feld.value; merken(); };
      try { erk.start(); } catch(e){}
    };
  });
}

/* ── Abschliessen ── */
function abschliessen(){
  var s=sitz();
  if(s.status==='abgeschlossen'){ s.status='laeuft'; merken(); zeichnen(); return; }
  var offen=(s.parkplatz||[]).filter(function(p){ return !p.erledigung; });
  if(offen.length && !confirm(offen.length+' Punkt(e) auf dem Parkplatz haben noch keine '
      +'Erledigung. Trotzdem abschliessen?\n\nIm Hörbuch steht: was auf dem Parkplatz landet, '
      +'darf nicht verschwinden – sonst vertraut die Runde ihm nicht mehr.')) return;
  if(TIMER.box) timerStopp();
  s.status='abgeschlossen'; s.abgeschlossen=Date.now();
  merken(); spiegeln(); zeichnen();
  $('siFertigMsg').textContent='Abgeschlossen. Jetzt Druckansicht öffnen und als PDF an den '
    +'Verteiler schicken – oder am PC SITZUNG_PROTOKOLL.bat starten.';
}

/* ═══════════════════════════════════════════════════════════
   BLATT 2 – Pendenzen über alle Sitzungen
   ═══════════════════════════════════════════════════════════ */
function pendenzBlatt(){
  var alle=allePendenzen();
  var heuteIso=heute();
  var zaehl={ offen:0, ueberfaellig:0, laeuft:0, erledigt:0 };
  alle.forEach(function(p){
    var st=p.status||'offen';
    if(st==='erledigt') zaehl.erledigt++;
    else if(st==='laeuft') zaehl.laeuft++;
    else zaehl.offen++;
    if(st!=='erledigt' && p.bis && p.bis<heuteIso) zaehl.ueberfaellig++;
  });
  var liste=alle.filter(function(p){
    var st=p.status||'offen';
    if(pendFilter==='offen') return st!=='erledigt';
    if(pendFilter==='ueberfaellig') return st!=='erledigt' && p.bis && p.bis<heuteIso;
    if(pendFilter==='erledigt') return st==='erledigt';
    return true;
  }).sort(function(a,b){ return (a.bis||'9999').localeCompare(b.bis||'9999'); });

  var f=[['offen','Offen'],['ueberfaellig','Überfällig'],['erledigt','Erledigt'],['alle','Alle']];
  $('siInhalt').innerHTML=
    '<div class="si-kach">'
      +'<div><b>'+zaehl.offen+'</b><span>offen</span></div>'
      +'<div style="border-top-color:#D72622"><b>'+zaehl.ueberfaellig+'</b><span>überfällig</span></div>'
      +'<div style="border-top-color:#e08a00"><b>'+zaehl.laeuft+'</b><span>läuft</span></div>'
      +'<div style="border-top-color:#2e9e46"><b>'+zaehl.erledigt+'</b><span>erledigt</span></div>'
    +'</div>'
    +'<div class="si-hin">Alle Punkte aus allen Koordinationssitzungen. Der Stand lässt sich '
      +'hier jederzeit setzen – auch zwischen zwei Sitzungen. Vor der nächsten Sitzung einmal '
      +'durchgehen, dann muss die Runde nicht darüber diskutieren.</div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">'
      +f.map(function(x){ return '<button class="si-kn mini'+(pendFilter===x[0]?' rot':'')
          +'" data-pf="'+x[0]+'">'+x[1]+'</button>'; }).join('')
      +'<span style="flex:1"></span>'
      +'<button class="si-kn mini" id="siPendCsv">⬇ CSV</button></div>'
    +(liste.length? '<div style="overflow-x:auto"><table class="si-tab"><thead><tr>'
      +'<th>Was</th><th>Wer</th><th>Bis</th><th>Aus</th><th>Stand</th></tr></thead><tbody>'
      +liste.map(function(p){
        var st=p.status||'offen';
        var sd=PSTATUS.filter(function(x){ return x.id===st; })[0]||PSTATUS[0];
        var spaet=st!=='erledigt' && p.bis && p.bis<heuteIso;
        return '<tr style="background:'+(spaet?'#FBE9E7':sd.f)+'">'
          +'<td>'+h(p.was)+(p.bemerkung?'<div style="font-size:11px;color:#63676d">'
              +h(p.bemerkung)+'</div>':'')+'</td>'
          +'<td style="white-space:nowrap">'+h(p.wer||'?')+'</td>'
          +'<td style="white-space:nowrap'+(spaet?';color:#a3231f;font-weight:700':'')+'">'
              +deDat(p.bis||'')+'</td>'
          +'<td style="white-space:nowrap;font-size:11.5px;color:#63676d">'+deDat(p.sitzung)+'</td>'
          +'<td style="white-space:nowrap">'+PSTATUS.map(function(x){
              return '<button class="si-kn mini'+(x.id===st?' rot':'')+'" data-ps="'+p.id
                +'" data-st="'+x.id+'">'+x.n+'</button>'; }).join(' ')
            +' <button class="si-kn mini" data-pb="'+p.id+'">✎</button></td></tr>';
      }).join('')+'</tbody></table></div>'
      : '<div class="si-leer">Nichts in dieser Auswahl.</div>');

  Array.prototype.forEach.call(document.querySelectorAll('[data-pf]'),function(b){
    b.onclick=function(){ pendFilter=b.getAttribute('data-pf'); pendenzBlatt(); };
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ps]'),function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-ps');
      pendMerken(id,{ status:b.getAttribute('data-st'), bemerkung:(PUEBER[id]||{}).bemerkung||'',
                      ts:Date.now(), von:wer(), sitzung:AKTIV||heute() });
      pendenzBlatt(); navZeichnen();
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-pb]'),function(b){
    b.onclick=function(){
      var id=b.getAttribute('data-pb'), alt=(PUEBER[id]||{}).bemerkung||'';
      var neu=prompt('Bemerkung zum Stand:',alt); if(neu===null) return;
      pendMerken(id,{ status:(PUEBER[id]||{}).status||'offen', bemerkung:neu.trim(),
                      ts:Date.now(), von:wer(), sitzung:AKTIV||heute() });
      pendenzBlatt();
    };
  });
  $('siPendCsv').onclick=function(){ csvPendenzen(liste); };
}

function csvPendenzen(liste){
  var z=[['Was','Wer','Bis','Status','Bemerkung','aus Sitzung']];
  liste.forEach(function(p){ z.push([p.was,p.wer||'',p.bis||'',p.status||'offen',
    p.bemerkung||'',p.sitzung]); });
  var csv='﻿'+z.map(function(r){ return r.map(function(c){
    return '"'+String(c).replace(/"/g,'""')+'"'; }).join(';'); }).join('\r\n');
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='Pendenzen_Koordinationssitzung_'+heute().replace(/-/g,'')+'.csv';
  a.click();
}

/* ═══════════════════════════════════════════════════════════
   BLATT 3 – Archiv
   ═══════════════════════════════════════════════════════════ */
function archivBlatt(){
  var d=Object.keys(SITZUNGEN).sort().reverse();
  if(!d.length){ $('siInhalt').innerHTML='<div class="si-leer">Noch keine Sitzung erfasst.</div>'; return; }
  $('siInhalt').innerHTML='<div class="si-hin">Alle im Web geführten Protokolle. '
      +'Ältere Sitzungen liegen weiter als PDF in <code>Protokolle\\</code> und in OneNote.</div>'
    +'<div style="overflow-x:auto"><table class="si-tab"><thead><tr><th>Sitzung</th>'
    +'<th>Anwesend</th><th>Pendenzen</th><th>Stand</th><th></th></tr></thead><tbody>'
    +d.map(function(k){
      var s=SITZUNGEN[k];
      var da=Object.keys(s.teilnehmer||{}).filter(function(p){ return s.teilnehmer[p]==='da'; }).length;
      var pn=(s.pendenzen||[]).length;
      var st=s.status==='abgeschlossen'
        ? '<span class="si-amp" style="background:#E8F6EC;color:#1c6b34">abgeschlossen</span>'
        : '<span class="si-amp" style="background:#FFF4E0;color:#8a5a00">offen</span>';
      return '<tr><td><b>'+wochentag(k)+' '+deDat(k)+'</b><div style="font-size:11px;color:#63676d">'
          +h(s.ort||'')+'</div></td>'
        +'<td>'+da+' von '+RUNDE.length+'</td><td>'+pn+'</td><td>'+st+'</td>'
        +'<td style="white-space:nowrap"><button class="si-kn mini" data-oe="'+k+'">öffnen</button> '
        +'<button class="si-kn mini" data-dr="'+k+'">🖨</button></td></tr>';
    }).join('')+'</tbody></table></div>'
    +'<div style="margin-top:12px"><button class="si-kn rot" id="siArNeu">'
      +'+ neue Sitzung '+deDat(naechsterTermin())+'</button></div>';

  Array.prototype.forEach.call(document.querySelectorAll('[data-oe]'),function(b){
    b.onclick=function(){ AKTIV=b.getAttribute('data-oe'); BLATT='sitzung'; zeichnen();
      window.scrollTo(0,0); };
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-dr]'),function(b){
    b.onclick=function(){ drucken(b.getAttribute('data-dr')); };
  });
  $('siArNeu').onclick=function(){
    var n=naechsterTermin();
    if(!SITZUNGEN[n]) SITZUNGEN[n]=neueSitzung(n);
    AKTIV=n; BLATT='sitzung'; merken(); zeichnen(); window.scrollTo(0,0);
  };
}

/* ═══════════════════════════════════════════════════════════
   Druckansicht – das ist das Protokoll, das aufgelegt und
   versendet wird. Tabellen und Ampelfarben statt Fliesstext.
   ═══════════════════════════════════════════════════════════ */
function drucken(datum){
  var s=SITZUNGEN[typeof datum==='string'?datum:AKTIV]; if(!s) return;
  var w=window.open('','_blank'); if(!w){ alert('Der Browser hat das Fenster blockiert.'); return; }
  w.document.write(protokollHtml(s));
  w.document.close();
}

function protokollHtml(s){
  var da=RUNDE.filter(function(p){ return (s.teilnehmer||{})[p.id]==='da'; });
  var weg=RUNDE.filter(function(p){ return (s.teilnehmer||{})[p.id]==='fehlt'; });
  var z=s.zahlen||LIVE||{};
  var reden=(s.reden||[]).filter(function(x){ return x && x.trim(); });
  var offenVor=offenePendenzenVor(s.datum);

  var css='body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:11pt;line-height:1.45;'
    +'margin:0;padding:18mm 15mm}h1{font-size:17pt;margin:0 0 2px}h2{font-size:12.5pt;margin:16px 0 6px;'
    +'padding-bottom:3px;border-bottom:2px solid #D72622}h3{font-size:11pt;margin:11px 0 4px}'
    +'.kopf{border-bottom:4px solid #D72622;padding-bottom:9px;margin-bottom:12px}'
    +'.wann{font-size:10pt;color:#555;font-weight:bold}'
    +'table{width:100%;border-collapse:collapse;font-size:9.5pt;margin:6px 0 10px}'
    +'th{background:#f0f2f4;text-align:left;padding:5px 7px;border:1px solid #d5d9dd;font-size:8.5pt;'
    +'text-transform:uppercase;letter-spacing:.03em}'
    +'td{padding:5px 7px;border:1px solid #d5d9dd;vertical-align:top}'
    +'.rot{background:#FBE9E7}.or{background:#FFF4E0}.gr{background:#E8F6EC}'
    +'.kach{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 12px}'
    +'.kach div{border:1px solid #d5d9dd;border-top:3px solid #D72622;border-radius:4px;'
    +'padding:6px 10px;min-width:96px}'
    +'.kach b{display:block;font-size:15pt;font-weight:900;line-height:1.1}'
    +'.kach span{font-size:7.8pt;color:#555;font-weight:bold}'
    +'.reden{border:1px solid #1a1a1a;border-left:5px solid #1a1a1a;padding:9px 12px;margin:8px 0 12px}'
    +'.reden ol{margin:4px 0 0;padding-left:20px}.reden li{margin-bottom:3px;font-weight:bold}'
    +'.lob{background:#E8F6EC;border-left:5px solid #2e9e46;padding:8px 12px;margin:10px 0}'
    +'.park{background:#fffdf5;border-left:5px solid #e08a00;padding:8px 12px;margin:10px 0}'
    +'.txt{white-space:pre-wrap;font-size:10pt}'
    +'.q{font-size:8pt;color:#666;border-top:1px solid #d5d9dd;padding-top:7px;margin-top:16px;line-height:1.5}'
    +'.leer{color:#888;font-style:italic;font-size:9.5pt}'
    +'@page{size:A4;margin:14mm}@media print{h2{page-break-after:avoid}table{page-break-inside:auto}'
    +'tr{page-break-inside:avoid}.knopf{display:none}}'
    +'.knopf{position:fixed;top:10px;right:12px;background:#D72622;color:#fff;border:0;border-radius:5px;'
    +'padding:9px 15px;font:700 13px Arial;cursor:pointer}';

  var o='<!doctype html><html lang="de"><head><meta charset="utf-8">'
    +'<title>Koordinationssitzung '+deDat(s.datum)+' · NalpSolar</title>'
    +'<style>'+css+'</style></head><body>'
    +'<button class="knopf" onclick="window.print()">🖨 Drucken / PDF</button>'
    +'<div class="kopf"><h1>Koordinationssitzung BF / PL</h1>'
    +'<div class="wann">NalpSolar B8-13 · '+wochentag(s.datum)+' '+deDat(s.datum)+' · '
      +h(s.zeit)+' Uhr · '+h(s.ort)+' · Protokoll: '+h(s.protokoll)+'</div></div>';

  o+='<table><tr><td style="width:14%;background:#f7f8f9"><b>Anwesend</b></td><td>'
    +(da.length? da.map(function(p){ return h(p.name); }).join(' · ') : '<span class="leer">–</span>')
    +(s.gaeste?' · '+h(s.gaeste):'')+'</td></tr>'
    +(weg.length?'<tr><td style="background:#f7f8f9"><b>Entschuldigt</b></td><td>'
      +weg.map(function(p){ return h(p.name); }).join(' · ')+'</td></tr>':'')
    +(s.schwerpunkt?'<tr><td style="background:#f7f8f9"><b>Schwerpunkt</b></td><td>'
      +h(s.schwerpunkt)+'</td></tr>':'')+'</table>';

  if(reden.length) o+='<div class="reden"><b>Darüber müssen wir heute reden</b><ol>'
    +reden.map(function(t){ return '<li>'+h(t)+'</li>'; }).join('')+'</ol></div>';

  /* Zahlen */
  if(z.bohr||z.tische){
    o+='<h2>Zahlen auf einen Blick</h2><div class="kach">';
    if(z.bohr) o+='<div><b>'+z.bohr.gebohrt.toLocaleString('de-CH')+'</b><span>GEBOHRT VON '
        +z.bohr.total.toLocaleString('de-CH')+'</span></div>'
      +'<div><b>'+z.bohr.injiziert.toLocaleString('de-CH')+'</b><span>INJIZIERT</span></div>'
      +'<div><b>'+z.bohr.offenInj.toLocaleString('de-CH')+'</b><span>GEBOHRT, NICHT INJIZIERT</span></div>'
      +'<div><b>'+z.bohr.offenVerm.toLocaleString('de-CH')+'</b><span>GEBOHRT, NICHT VERMESSEN</span></div>';
    if(z.tische) o+='<div><b>'+z.tische.pk+'</b><span>PRIMÄRKONSTRUKTION</span></div>'
      +'<div><b>'+z.tische.mt+'</b><span>MODULTRÄGER</span></div>'
      +'<div><b>'+(z.vormontiert||0)+'</b><span>VORMONTIERT</span></div>'
      +'<div><b>'+z.tische.verschraubt+'</b><span>VERSCHRAUBT</span></div>';
    o+='</div>';
    if(z.woche) o+='<table><tr><th>Zeitraum</th><th>Primärkonstruktion</th><th>Modulträger</th>'
      +'<th>Verschraubt</th></tr><tr><td>KW'+z.woche.kw+' (laufend)</td><td>'+z.woche.pk+'</td>'
      +'<td>'+z.woche.mt+'</td><td>'+(z.woche.vs||0)+'</td></tr>'
      +'<tr><td>KW'+z.woche.kwVor+'</td><td>'+z.woche.vorPk+'</td><td>'+z.woche.vorMt+'</td>'
      +'<td>–</td></tr></table>';
  }

  /* Abgleich */
  if(offenVor.length){
    o+='<h2>Abgleich zur letzten Sitzung</h2><table><tr><th>Punkt</th><th>Wer</th><th>Bis</th>'
      +'<th>Stand heute</th></tr>'
      +offenVor.map(function(p){
        var st=p.status||'offen';
        var kl= st==='erledigt'?'gr':(st==='laeuft'?'or':'rot');
        var n=(PSTATUS.filter(function(x){ return x.id===st; })[0]||PSTATUS[0]).n;
        return '<tr><td>'+h(p.was)+'<br><span style="font-size:8pt;color:#666">aus '
          +deDat(p.sitzung)+'</span></td><td>'+h(p.wer||'?')+'</td><td>'+deDat(p.bis||'')+'</td>'
          +'<td class="'+kl+'"><b>'+n+'</b>'+(p.bemerkung?'<br>'+h(p.bemerkung):'')+'</td></tr>';
      }).join('')+'</table>';
  }

  /* Boxen */
  ABLAUF.forEach(function(b){
    var d=(s.boxen||{})[b.id]||{};
    if(!d.text||!d.text.trim()) return;
    o+='<h2>'+h(b.titel)+'</h2><div class="txt">'+h(d.text.trim())+'</div>';
  });

  /* Parkplatz */
  var park=(s.parkplatz||[]);
  if(park.length){
    var nam={ besprochen:'in der Sitzung besprochen', pendenz:'als Pendenz aufgenommen',
              termin:'eigener Termin', '':'noch offen' };
    o+='<h2>Parkplatz</h2><table><tr><th>Punkt</th><th>Von</th><th>Erledigung</th></tr>'
      +park.map(function(p){
        var kl= p.erledigung?'gr':'or';
        return '<tr><td>'+h(p.text)+'</td><td>'+h(p.von||'–')+'</td>'
          +'<td class="'+kl+'">'+h(nam[p.erledigung||''])+'</td></tr>'; }).join('')+'</table>';
  }

  /* Pendenzen: die dieser Sitzung + alles, was offen bleibt */
  var alle=pendenzenFuer(s);
  if(alle.length){
    o+='<h2>Pendenzen</h2><table><tr><th style="width:52%">Was</th><th>Wer</th><th>Bis</th>'
      +'<th>Stand</th></tr>'
      +alle.map(function(p){
        var st=p.status||'offen';
        var kl= st==='erledigt'?'gr':(st==='laeuft'?'or':(p.bis&&p.bis<heute()?'rot':''));
        var n=(PSTATUS.filter(function(x){ return x.id===st; })[0]||PSTATUS[0]).n;
        return '<tr class="'+kl+'"><td>'+h(p.was)+(p.sitzung!==s.datum
            ?'<br><span style="font-size:8pt;color:#666">aus '+deDat(p.sitzung)+'</span>':'')
          +'</td><td>'+h(p.wer||'?')+'</td><td>'+deDat(p.bis||'')+'</td><td>'+n+'</td></tr>';
      }).join('')+'</table>';
  }

  if(s.lob && s.lob.trim()) o+='<div class="lob"><b>Was gut läuft</b><br>'
    +'<span class="txt">'+h(s.lob.trim())+'</span></div>';

  o+='<div class="q"><b>Datenstand:</b> Nalpi-Automatik '+deDat((z&&z.stand)||'')
    +' · Vormontage, Verschrauben und Lager aus der Website-Datenbank.<br>'
    +'<b>Nächste Sitzung:</b> '+wochentag(naechsterTerminNach(s.datum))+' '
    +deDat(naechsterTerminNach(s.datum))+', '+h(s.zeit)+' Uhr, '+h(s.ort)+'.<br>'
    +'Geführt im Admin-Werkzeug der Baustellen-Website · '
    +'Einwände zum Protokoll innert zwei Arbeitstagen an '+h(s.protokoll)+'.</div>'
    +'</body></html>';
  return o;
}

function naechsterTerminNach(iso){
  var d=new Date(iso+'T12:00:00');
  for(var i=1;i<=8;i++){
    var t=new Date(d.getTime()+i*86400000);
    if(t.getDay()===2||t.getDay()===4)
      return t.getFullYear()+'-'+z2(t.getMonth()+1)+'-'+z2(t.getDate());
  }
  return iso;
}

/* Reiner Text für eine Mail (Mailstil Victor: kurz, ohne Zierrat). */
function alsTextKopieren(){
  var s=sitz(); if(!s) return;
  var t='Koordinationssitzung BF/PL – '+wochentag(s.datum)+' '+deDat(s.datum)+', '+s.zeit+' Uhr, '+s.ort+'\n';
  t+='Protokoll: '+s.protokoll+'\n\n';
  var da=RUNDE.filter(function(p){ return (s.teilnehmer||{})[p.id]==='da'; })
              .map(function(p){ return p.name; });
  t+='Anwesend: '+da.join(', ')+(s.gaeste?', '+s.gaeste:'')+'\n\n';
  var reden=(s.reden||[]).filter(function(x){ return x&&x.trim(); });
  if(reden.length){ t+='DARÜBER HABEN WIR GEREDET\n';
    reden.forEach(function(r,i){ t+='  '+(i+1)+'. '+r+'\n'; }); t+='\n'; }
  ABLAUF.forEach(function(b){
    var d=(s.boxen||{})[b.id]||{};
    if(!d.text||!d.text.trim()) return;
    t+=b.titel.toUpperCase()+'\n'+d.text.trim().split('\n').map(function(z){
      return '  '+z; }).join('\n')+'\n\n';
  });
  var pn=pendenzenFuer(s);
  if(pn.length){ t+='PENDENZEN\n';
    pn.forEach(function(p){
        t+='  [ ] '+p.was+' — '+(p.wer||'?')+', bis '+deDat(p.bis||'')
          +(p.status&&p.status!=='offen'?' ('+p.status+')':'')+'\n'; });
    t+='\n'; }
  if(s.lob&&s.lob.trim()) t+='GUT GELAUFEN\n  '+s.lob.trim()+'\n\n';
  t+='Nächste Sitzung: '+wochentag(naechsterTerminNach(s.datum))+' '
    +deDat(naechsterTerminNach(s.datum))+', '+s.zeit+' Uhr, '+s.ort+'.\n';

  var fertig=function(){ $('siFertigMsg').textContent='Protokolltext ist in der Zwischenablage.'; };
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(t).then(fertig,function(){ notfall(t); });
  else notfall(t);
  function notfall(x){
    var ta=document.createElement('textarea'); ta.value=x; document.body.appendChild(ta);
    ta.select(); try{ document.execCommand('copy'); fertig(); }catch(e){}
    document.body.removeChild(ta);
  }
}

/* zahlenAus und protokollHtml sind aussen sichtbar, damit sich die Rechnung
   und die Druckausgabe ohne Browser pruefen lassen (Tools\Sitzung_Test.js). */
/* zahlenAus, protokollHtml und daten sind aussen sichtbar, damit sich Rechnung
   und Druckausgabe ohne Browser erzeugen lassen: Tools\Sitzung_Protokoll.py
   rendert das Protokoll ueber Node mit genau diesem Code. So gibt es nur EINE
   Stelle, an der das Protokoll formatiert wird. */
function daten(sitzungen, ueberlagerung){
  if(sitzungen) SITZUNGEN=sitzungen;
  if(ueberlagerung) PUEBER=ueberlagerung;
}
return { start:start, druck:drucken, zahlenAus:zahlenRechnen, protokollHtml:protokollHtml,
         daten:daten, ablauf:ABLAUF, runde:RUNDE };
})();
