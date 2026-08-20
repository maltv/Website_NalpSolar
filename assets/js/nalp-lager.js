/* nalp-lager.js — laufende Normteil-Inventur auf dem IP Tal 1
 *
 * Wunsch Mariusz / Auftrag Victor 20.08.2026: den Bestand im Tal laufend führen
 * statt zweimal im Jahr zählen. Erfasst werden fünf Teile:
 *   Knieträger S-1 · Knieträger S-4 · Quertraverse · Normstütze Berg · Normstütze Tal
 *
 * Rechenweg  Bestand = letzte Zählung
 *                     + erfasste Zugänge (Lieferungen)
 *                     − erfasste Abgänge (was mit auf den Berg geht)
 *                     − automatische Abgänge aus den Vormontage-Meldungen:
 *                       je vormontierter Tisch 1 Knieträger S-1, 1 S-4, 2 Normstützen Berg
 *                       im Typ des Tischs. Quertraversen NICHT automatisch – die gehen
 *                       erst beim Hochtransport weg und werden dort erfasst
 *                       (Entscheid Victor 20.08.2026).
 *
 * Startwerte und Bedarf kommen aus uploads/material.json (Reiter «Material» im Admin,
 * erzeugt von Tools\Material_Bilanz_Bauen.py). Sobald Mariusz zählt, gilt seine Zahl.
 * Normstützen Tal stehen dort nicht – die werden nicht mehr verbaut, sondern gehen
 * zurück nach Sursee; hier werden sie nur gezählt, damit die Menge für den
 * Rücklieferschein bekannt ist.
 *
 * Einbau:  NalpLager.start(div) · NalpLager.sprache('de'|'en'|'pl')
 *          NalpLager.mitFormular(div) / .mitSpeichern(...)  – Zusatzteile beim Bergtransport
 *          NalpLager.engpaesse()  – für Karte und Warnung
 * Läuft offline: Warteschlange in IndexedDB (Fotos sprengen den localStorage).
 */
(function(){
'use strict';

var DB='https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app';
var P_INV='erfassung/nt_inventur', P_FOTO='erfassung/nt_fotos', P_FO='erfassung/vm_fortschritt';
var LS_VON='nalp_erfasser_v1', IDB_NAME='nalp_lager', IDB_STORE='jobs', LS_PEND='nalp_lager_pend';

/* Ab wie wenigen baubaren Tischen gilt ein Teil als Engpass (Ampel rot, Meldung). */
var ENG_TISCHE=3;

var L='de', ZIEL=null, ANSICHT='bestand', LAEUFT=null;
var MAT=null, TYPEN=null, INV=null, FORT=null;
var eArt='zaehlung', eTeil=null, eTyp=null, eSerie=null, eAnzahl=0, eFoto=null;
var mitZeilen=[];

/* ─────────────── Teile ───────────────
   jeTisch = wie viele Stück ein Tisch braucht (ILF-Stückliste, Koo-Liste Blatt
   «Auswertung»); wann = zu welchem Zeitpunkt das Teil das Lager verlässt. */
var TEILE=[
 {id:'kt1', jeTisch:1, wann:'vormontage', de:'Knieträger S-1', en:'Knee beam S-1', pl:'Wspornik S-1',
  hde:'talseitig bei S1', hen:'valley side at S1', hpl:'od doliny przy S1'},
 {id:'kt4', jeTisch:1, wann:'vormontage', de:'Knieträger S-4', en:'Knee beam S-4', pl:'Wspornik S-4',
  hde:'talseitig bei S4', hen:'valley side at S4', hpl:'od doliny przy S4'},
 {id:'nsb', jeTisch:2, wann:'vormontage', de:'Normstütze Berg', en:'Standard post mountain', pl:'Podpora górska',
  hde:'2 Stück je Tisch', hen:'2 per table', hpl:'2 sztuki na stół'},
 {id:'qt',  jeTisch:1, wann:'berg', de:'Quertraverse', en:'Cross beam', pl:'Trawersa poprzeczna',
  hde:'geht erst mit auf den Berg', hen:'leaves only with the transport up', hpl:'idzie dopiero na górę'},
 {id:'nst', jeTisch:0, wann:'rueck', de:'Normstütze Tal', en:'Standard post valley', pl:'Podpora dolinowa',
  hde:'geht zurück nach Sursee', hen:'goes back to Sursee', pl_h:'', hpl:'wraca do Sursee'}
];
/* Normstützen Tal gibt es nur aus der Serie 2025 (ab 2026 ist die Talstütze
   passgenau) – Typen gemäss ILF-Mail 08.05.2026. */
var NST_TYPEN=['A','B','D','E'];
var FARBE={A:'#1565c0', B:'#D72622', C:'#8b929b', D:'#1e9e5a', E:'#e0a800'};

/* ─────────────── Texte ─────────────── */
var T={
 de:{ titel:'📦 Lager Tal', bestand:'Bestand', erfassen:'Erfassen',
  frage_art:'Was machst du?',
  negativ:'Mehr verbraucht als gezählt – bitte neu zählen.',
  gerechnet:'Gerechnet wären es {n} Stk – Abweichung ist normal, deine Zählung gilt.',
  art_zaehlung:'📋 Gezählt', art_zugang:'📥 Geliefert', art_abgang:'📤 Weggegangen',
  art_zaehlung_h:'Bestand neu setzen', art_zugang_h:'Zugang buchen', art_abgang_h:'Abgang buchen',
  frage_teil:'Welches Teil?', frage_typ:'Welcher Typ?', frage_serie:'Welche Serie?', frage_anzahl:'Wie viele?',
  s2025:'2025', s2026:'2026', beide:'2025 + 2026 gleich',
  farbhilfe:'Farbe = Typ · weisser Strich = Serie 2026',
  foto:'📷 Foto (empfohlen)', foto_neu:'Foto ersetzen', name:'Dein Name', speichern:'💾 Speichern',
  gespeichert:'Gespeichert. Bestand jetzt: {n}', wartet:'Kein Netz – wird nachgesendet.',
  fehlt_teil:'Bitte Teil, Typ und Anzahl angeben.', fehlt_name:'Bitte den Namen eintragen.',
  reicht:'reicht für {n} Tische', reicht1:'reicht für 1 Tisch', reicht0:'reicht für keinen Tisch mehr',
  bedarf:'Bedarf Rest 2026: {n}', ungezaehlt:'noch nie gezählt', stueck:'Stk',
  basis:'Stand seit {q}', seither:'seither {z} rein, {a} raus',
  zurueck:'Geht komplett zurück nach Sursee – nur zählen, nicht verbauen.',
  laden:'Lade Bestand …', fehler:'Daten liessen sich nicht laden.',
  eng_titel:'⚠️ Engpass', eng_keiner:'Kein Engpass – alle Teile reichen für die nächsten Tische.',
  mit_titel:'Was geht mit hoch?', mit_hilfe:'Nur was hier steht, geht vom Lager ab. Quertraversen immer eintragen.',
  mit_zeile:'+ Teil hinzufügen', mit_keine:'nichts ausser der Konstruktion',
  anzahl:'Anzahl', entfernen:'entfernen', warnung_wenig:'Nur noch {n} {t} am Lager.',
  push_an:'🔔 Warnung aufs Handy', push_aus:'🔔 Warnung ist an', push_geht_nicht:'Dein Gerät kann keine Meldungen empfangen.',
  push_ok:'Meldung eingeschaltet.', push_nein:'Ohne Erlaubnis geht keine Meldung.' },
 en:{ titel:'📦 Valley store', bestand:'Stock', erfassen:'Record',
  frage_art:'What are you doing?',
  negativ:'More used than counted – please count again.',
  gerechnet:'The calculation says {n} pcs – a difference is normal, your count wins.',
  art_zaehlung:'📋 Counted', art_zugang:'📥 Delivered', art_abgang:'📤 Taken away',
  art_zaehlung_h:'set the stock', art_zugang_h:'book an inflow', art_abgang_h:'book an outflow',
  frage_teil:'Which part?', frage_typ:'Which type?', frage_serie:'Which series?', frage_anzahl:'How many?',
  s2025:'2025', s2026:'2026', beide:'2025 + 2026 identical',
  farbhilfe:'Colour = type · white stripe = series 2026',
  foto:'📷 Photo (recommended)', foto_neu:'Replace photo', name:'Your name', speichern:'💾 Save',
  gespeichert:'Saved. Stock now: {n}', wartet:'No connection – will be sent later.',
  fehlt_teil:'Please pick part, type and quantity.', fehlt_name:'Please enter your name.',
  reicht:'enough for {n} tables', reicht1:'enough for 1 table', reicht0:'not enough for one table',
  bedarf:'Needed rest of 2026: {n}', ungezaehlt:'never counted', stueck:'pcs',
  basis:'based on {q}', seither:'since then {z} in, {a} out',
  zurueck:'Goes back to Sursee completely – only count it, do not install.',
  laden:'Loading stock …', fehler:'Could not load the data.',
  eng_titel:'⚠️ Short', eng_keiner:'No shortage – every part covers the next tables.',
  mit_titel:'What goes up with it?', mit_hilfe:'Only what is listed here leaves the store. Always enter cross beams.',
  mit_zeile:'+ add part', mit_keine:'nothing but the structure',
  anzahl:'Quantity', entfernen:'remove', warnung_wenig:'Only {n} {t} left in the store.',
  push_an:'🔔 Alert on my phone', push_aus:'🔔 Alert is on', push_geht_nicht:'This device cannot receive alerts.',
  push_ok:'Alert switched on.', push_nein:'Without permission there is no alert.' },
 pl:{ titel:'📦 Magazyn w dolinie', bestand:'Stan', erfassen:'Zapisz',
  frage_art:'Co robisz?',
  negativ:'Zużyto więcej niż policzono – policz ponownie.',
  gerechnet:'Wyliczenie mówi {n} szt – różnica jest normalna, liczy się Twój wynik.',
  art_zaehlung:'📋 Policzone', art_zugang:'📥 Dostawa', art_abgang:'📤 Wydane',
  art_zaehlung_h:'ustaw stan na nowo', art_zugang_h:'zapisz przyjęcie', art_abgang_h:'zapisz wydanie',
  frage_teil:'Która część?', frage_typ:'Który typ?', frage_serie:'Która seria?', frage_anzahl:'Ile sztuk?',
  s2025:'2025', s2026:'2026', beide:'2025 + 2026 takie same',
  farbhilfe:'Kolor = typ · biały pasek = seria 2026',
  foto:'📷 Zdjęcie (zalecane)', foto_neu:'Zmień zdjęcie', name:'Twoje imię i nazwisko', speichern:'💾 Zapisz',
  gespeichert:'Zapisano. Stan: {n}', wartet:'Brak sieci – wyślemy później.',
  fehlt_teil:'Wybierz część, typ i ilość.', fehlt_name:'Wpisz imię i nazwisko.',
  reicht:'wystarczy na {n} stołów', reicht1:'wystarczy na 1 stół', reicht0:'nie wystarczy na żaden stół',
  bedarf:'Potrzeba do końca 2026: {n}', ungezaehlt:'nigdy nie liczone', stueck:'szt',
  basis:'stan od {q}', seither:'od tego czasu {z} przyjęto, {a} wydano',
  zurueck:'Wraca w całości do Sursee – tylko policzyć, nie montować.',
  laden:'Wczytywanie stanu …', fehler:'Nie udało się wczytać danych.',
  eng_titel:'⚠️ Brakuje', eng_keiner:'Brak niedoborów – wszystkiego starcza na kolejne stoły.',
  mit_titel:'Co jedzie na górę?', mit_hilfe:'Z magazynu schodzi tylko to, co tu wpiszesz. Trawersy zawsze wpisuj.',
  mit_zeile:'+ dodaj część', mit_keine:'nic oprócz konstrukcji',
  anzahl:'Ilość', entfernen:'usuń', warnung_wenig:'Zostało tylko {n} {t}.',
  push_an:'🔔 Alarm na telefon', push_aus:'🔔 Alarm włączony', push_geht_nicht:'To urządzenie nie odbiera powiadomień.',
  push_ok:'Alarm włączony.', push_nein:'Bez zgody nie ma powiadomień.' }
};
function t(k,p){ var s=(T[L]&&T[L][k])||T.de[k]||k;
  if(p) for(var x in p) s=s.split('{'+x+'}').join(p[x]);
  return s; }
function tt(o,f){ f=f||''; return o[f+L]||o[f+'de']||''; }
function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

/* ─────────────── Stil ─────────────── */
var CSS=''
+'.lg .lgnav{display:flex;gap:8px;margin-bottom:12px;}'
+'.lg .lgnav button{flex:1;border:1.5px solid #d7dade;background:#fff;color:#1a1a1a;font:inherit;'
 +'font-size:15px;font-weight:800;padding:13px 6px;border-radius:12px;cursor:pointer;}'
+'.lg .lgnav button.on{background:#1a1a1a;border-color:#1a1a1a;color:#fff;}'
+'.lg h3.lgh{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#63676d;'
 +'margin:16px 0 7px;font-weight:800;}'
+'.lg .lgz{display:flex;align-items:center;gap:11px;background:#fff;border:1px solid #e3e5e8;'
 +'border-radius:12px;padding:11px 12px;margin-bottom:7px;}'
+'.lg .lgz .pkt{width:15px;height:15px;border-radius:50%;flex:none;position:relative;}'
+'.lg .lgz .pkt.n26:after{content:"";position:absolute;left:50%;top:-2px;bottom:-2px;width:3px;'
 +'margin-left:-1.5px;background:#fff;border-radius:2px;}'
+'.lg .lgz .lgt{flex:1;min-width:0;}'
+'.lg .lgz .lgt b{font-size:15px;font-weight:800;}'
+'.lg .lgz .lgt span{display:block;font-size:12px;color:#63676d;margin-top:1px;}'
+'.lg .lgz .lgn{font-size:24px;font-weight:900;text-align:right;line-height:1;}'
+'.lg .lgz .lgn small{display:block;font-size:11px;font-weight:700;margin-top:3px;}'
+'.lg .lgz.rot{border-color:#D72622;background:#fff5f5;} .lg .lgz.rot .lgn{color:#D72622;}'
+'.lg .lgz.gelb{border-color:#e08a00;background:#fffaf0;} .lg .lgz.gelb .lgn{color:#b26a00;}'
+'.lg .lgz.gruen .lgn{color:#1e9e5a;}'
+'.lg .lgz.grau .lgn{color:#9aa0a6;}'
+'.lg .lgbox{background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:13px;margin-bottom:12px;}'
+'.lg .lgeng{background:#D72622;color:#fff;border-radius:12px;padding:13px 15px;margin-bottom:12px;'
 +'font-size:14.5px;font-weight:700;line-height:1.4;}'
+'.lg .lgeng b{font-weight:900;}'
+'.lg .lgok{background:#eaf6ee;border:1px solid #bfe3cd;color:#14663a;border-radius:12px;'
 +'padding:11px 13px;margin-bottom:12px;font-size:14px;font-weight:700;}'
+'.lg label.lgl{display:block;font-size:14px;font-weight:800;margin:14px 0 6px;}'
+'.lg .lgw{display:flex;flex-wrap:wrap;gap:7px;}'
+'.lg .lgw button{flex:1 1 46%;border:1.5px solid #d7dade;background:#fff;color:#1a1a1a;font:inherit;'
 +'font-size:14.5px;font-weight:800;padding:13px 8px;border-radius:12px;text-align:left;cursor:pointer;}'
+'.lg .lgw button.on{border-color:#1a1a1a;border-width:2.5px;background:#f3f5f7;}'
+'.lg .lgw button small{display:block;font-weight:600;font-size:11.5px;color:#63676d;margin-top:2px;}'
+'.lg .lgw.typ button{flex:1 1 18%;text-align:center;font-size:17px;font-weight:900;padding:14px 4px;}'
+'.lg .lgzahl{display:flex;align-items:center;gap:10px;margin-top:4px;}'
+'.lg .lgzahl button{width:60px;height:60px;border-radius:14px;border:1.5px solid #d7dade;'
 +'background:#fff;font:inherit;font-size:28px;font-weight:900;cursor:pointer;}'
+'.lg .lgzahl input{flex:1;min-width:0;text-align:center;font:inherit;font-size:30px;font-weight:900;'
 +'padding:11px;border:1.5px solid #d7dade;border-radius:14px;background:#fff;}'
+'.lg input.lgin{width:100%;font:inherit;font-size:16px;padding:12px;border:1.5px solid #d7dade;'
 +'border-radius:12px;background:#fff;}'
+'.lg .lgbtn{width:100%;border:0;background:#D72622;color:#fff;font:inherit;font-size:17px;'
 +'font-weight:900;padding:15px;border-radius:12px;margin-top:14px;cursor:pointer;}'
+'.lg .lgbtn.grau{background:#e3e8ed;color:#1a1a1a;}'
+'.lg .lgfoto{width:100%;border:1.5px dashed #c3c8ce;background:#fff;color:#1a1a1a;font:inherit;'
 +'font-size:15px;font-weight:800;padding:14px;border-radius:12px;margin-top:4px;cursor:pointer;}'
+'.lg .lgfoto img{max-width:100%;border-radius:9px;margin-top:9px;display:block;}'
+'.lg .lghint{font-size:12.5px;color:#63676d;margin-top:6px;line-height:1.35;}'
+'.lg .lgmit{border:1px solid #e3e5e8;border-radius:12px;padding:10px 11px;margin-bottom:8px;background:#fff;}'
+'.lg .lgmit .kopf{display:flex;justify-content:space-between;align-items:center;gap:8px;}'
+'.lg .lgmit select{font:inherit;font-size:14px;padding:9px;border:1.5px solid #d7dade;'
 +'border-radius:9px;background:#fff;flex:1;min-width:0;}'
+'.lg .lgmit input{width:64px;font:inherit;font-size:17px;font-weight:800;text-align:center;'
 +'padding:9px 4px;border:1.5px solid #d7dade;border-radius:9px;}'
+'.lg .lgmit .weg{border:0;background:none;color:#D72622;font:inherit;font-size:13px;'
 +'font-weight:800;cursor:pointer;padding:4px;}'
+'.lg .lgplus{width:100%;border:1.5px solid #d7dade;background:#fff;font:inherit;font-size:15px;'
 +'font-weight:800;padding:12px;border-radius:12px;cursor:pointer;}'
+'.lg .lgpush{width:100%;border:1.5px solid #1565c0;background:#fff;color:#1565c0;font:inherit;'
 +'font-size:15px;font-weight:800;padding:13px;border-radius:12px;margin-top:10px;cursor:pointer;}'
+'.lg .lgpush.an{background:#1565c0;color:#fff;}'
+'.lg .lgstand{font-size:11.5px;color:#63676d;text-align:center;margin-top:16px;}';

function stil(){ if(document.getElementById('lgStil')) return;
  var s=document.createElement('style'); s.id='lgStil'; s.textContent=CSS; document.head.appendChild(s); }

/* ─────────────── Daten ─────────────── */
function jget(p){ return fetch(p,{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; })
  .catch(function(){ return null; }); }
function api(p){ return jget(DB+'/'+p+'.json'); }

function laden(neu){
  if(LAEUFT && !neu) return LAEUFT;
  LAEUFT=Promise.all([
    MAT?Promise.resolve(MAT):jget('uploads/material.json'),
    TYPEN?Promise.resolve(TYPEN):jget('uploads/tables/typen.json'),
    api(P_INV), api(P_FO)
  ]).then(function(r){
    MAT=r[0];
    // typen.json ist verschachtelt: {stand, quelle, typen:{'<id>':'B_2026'}}
    TYPEN=(r[1]&&r[1].typen)||r[1]||{};
    INV=obj2arr(r[2]); FORT=obj2arr(r[3]);
    return true;
  });
  return LAEUFT;
}
function obj2arr(o){ var a=[]; if(!o) return a;
  for(var k in o){ var v=o[k]; if(v&&typeof v==='object'){ v._k=k; a.push(v); } } return a; }

/* Artikel = eine Zeile im Lager: Teil + Typ + Serie.
   Für Knieträger/Traverse/Bergstütze kommen sie aus material.json (dort steht auch
   der Bedarf); Normstützen Tal stehen dort nicht mehr und werden ergänzt. */
function artikel(){
  var li=[], gesehen={};
  ((MAT&&MAT.artikel)||[]).forEach(function(a){
    if(a.gruppe!=='normteile') return;
    var m=/^nt_(kt1|kt4|qt|nsb)_([a-e])(?:_(\d{4}))?$/.exec(a.id);
    if(!m) return;
    var x={ id:a.id, teil:m[1], typ:m[2].toUpperCase(), serie:m[3]||'', name:a.name,
            lager:(a.lager==null?null:a.lager), lagerArt:a.lager_art, lagerQuelle:a.lager_quelle,
            bedarf:(a.bedarf_2026==null?null:a.bedarf_2026), offen:a.bestellt_offen||0 };
    gesehen[x.teil+x.typ+x.serie]=1; li.push(x);
  });
  NST_TYPEN.forEach(function(ty){
    li.push({ id:'nst_'+ty.toLowerCase()+'_2025', teil:'nst', typ:ty, serie:'2025',
              name:'Normstütze Tal '+ty+' 2025', lager:null, lagerArt:null,
              lagerQuelle:null, bedarf:0, offen:0, rueck:true });
  });
  return li;
}
function teilDef(id){ for(var i=0;i<TEILE.length;i++) if(TEILE[i].id===id) return TEILE[i]; return null; }

/* Passt der Tischtyp (z.B. «B_2026») auf diesen Artikel?
   Artikel ohne Serie sind gepoolt (z.B. Quertraverse B: 2025 und 2026 bauteilgleich). */
function passt(a, tischTyp){
  if(!tischTyp) return false;
  var p=String(tischTyp).split('_');
  var ty=(p[0]||'').charAt(0).toUpperCase(), se=p[1]||'';
  if(ty!==a.typ) return false;
  return a.serie==='' || a.serie===se;
}

/* Erste Vormontage-Meldung je Tisch – spätere Korrekturen am selben Tisch dürfen
   den Bestand nicht ein zweites Mal belasten. */
function vormontageErste(){
  var erste={};
  FORT.forEach(function(f){
    if(f.art!=='vormontiert' || !f.tischId) return;
    var id=String(f.tischId), ts=+f.ts||0;
    if(!erste[id] || ts<erste[id]) erste[id]=ts;
  });
  return erste;
}

function bestand(a){
  var erg={ artikel:a, basis:null, basisText:'', seit:0, zugang:0, abgang:0, auto:0, bestand:null };
  var z=null;
  INV.forEach(function(e){
    if(e.artikel!==a.id || e.art!=='zaehlung') return;
    if(!z || (+e.ts||0)>(+z.ts||0)) z=e;
  });
  if(z){ erg.basis=+z.anzahl||0; erg.seit=+z.ts||0;
         erg.basisText=(z.datum||'')+(z.von?' · '+z.von:''); }
  else if(a.lager!=null){
    erg.basis=a.lager;
    var d=(a.lagerQuelle||'').match(/(\d{4})-(\d{2})-(\d{2})/);
    erg.seit=d?Date.parse(d[0]+'T23:59:59'):0;
    erg.basisText=a.lagerQuelle||'';
  } else return erg;                                    // nie gezählt

  INV.forEach(function(e){
    if(e.artikel!==a.id || (+e.ts||0)<=erg.seit) return;
    var n=+e.anzahl||0;
    if(e.art==='zugang') erg.zugang+=n;
    else if(e.art==='abgang') erg.abgang+=n;
  });
  var def=teilDef(a.teil);
  if(def && def.wann==='vormontage'){
    var erste=vormontageErste();
    for(var id in erste){
      if(erste[id]<=erg.seit) continue;
      if(passt(a, TYPEN[id])) erg.auto+=def.jeTisch;
    }
  }
  erg.bestand=erg.basis+erg.zugang-erg.abgang-erg.auto;
  return erg;
}

/* Wie viele Tische lassen sich mit dem Bestand noch bauen? */
function reicht(a,b){ var def=teilDef(a.teil);
  if(!def||!def.jeTisch||b==null) return null;
  return Math.floor(b/def.jeTisch); }

function ampel(a,e){
  if(a.rueck) return 'grau';
  if(e.bestand==null) return 'grau';
  var r=reicht(a,e.bestand);
  if(!a.bedarf) return 'gruen';                          // kein Bedarf mehr = egal
  if(r!==null && r<ENG_TISCHE) return 'rot';
  if(e.bestand<a.bedarf) return 'gelb';
  return 'gruen';
}

/* Für Karte und Warnung: welche Teile reichen nicht mehr? */
function engpaesse(){
  var li=[];
  artikel().forEach(function(a){
    if(a.rueck || !a.bedarf) return;
    var e=bestand(a);
    if(e.bestand==null) return;
    var r=reicht(a,e.bestand);
    if(r!==null && r<ENG_TISCHE) li.push({ artikel:a, bestand:e.bestand, reicht:r, bedarf:a.bedarf });
  });
  li.sort(function(x,y){ return x.reicht-y.reicht; });
  return li;
}

/* ─────────────── Warteschlange (IndexedDB, weil Fotos gross sind) ─────────────── */
var Q=(function(){
  var kann=!!window.indexedDB, dbP=null;
  function db(){ if(dbP) return dbP;
    dbP=new Promise(function(ok,fehl){
      var a=window.indexedDB.open(IDB_NAME,1);
      a.onupgradeneeded=function(){ if(!a.result.objectStoreNames.contains(IDB_STORE))
        a.result.createObjectStore(IDB_STORE,{keyPath:'k',autoIncrement:true}); };
      a.onsuccess=function(){ ok(a.result); };
      a.onerror=function(){ fehl(a.error); };
    }).catch(function(){ kann=false; return null; });
    return dbP; }
  function tx(m,arbeit){ return db().then(function(d){ if(!d) return null;
    return new Promise(function(ok,fehl){
      var t=d.transaction(IDB_STORE,m), s=t.objectStore(IDB_STORE), r=arbeit(s);
      t.oncomplete=function(){ ok(r&&r.result!==undefined?r.result:null); };
      t.onerror=function(){ fehl(t.error); };
    }); }); }
  function lsL(){ try{ return JSON.parse(localStorage.getItem(LS_PEND)||'[]'); }catch(e){ return []; } }
  function lsS(a){ try{ localStorage.setItem(LS_PEND,JSON.stringify(a.slice(-200))); }catch(e){} }
  return {
    add:function(job){ if(kann) return tx('readwrite',function(s){ return s.add(job); })
        .catch(function(){ kann=false; return Q.add(job); });
      var j={k:Date.now(), rec:job.rec};                 // ohne Foto, localStorage ist zu klein
      var a=lsL(); a.push(j); lsS(a); return Promise.resolve(j.k); },
    alle:function(){ if(kann) return tx('readonly',function(s){ return s.getAll(); })
        .then(function(r){ return r||[]; }).catch(function(){ return lsL(); });
      return Promise.resolve(lsL()); },
    weg:function(k){ if(kann) return tx('readwrite',function(s){ return s.delete(k); }).catch(function(){});
      lsS(lsL().filter(function(j){ return j.k!==k; })); return Promise.resolve(); }
  };
})();

function senden(rec, foto){
  var p=Promise.resolve(null);
  if(foto) p=fetch(DB+'/'+P_FOTO+'.json',{method:'POST',body:JSON.stringify({b:foto,ts:rec.ts})})
    .then(function(r){ return r.ok?r.json():null; }).then(function(j){ return j&&j.name; })
    .catch(function(){ return null; });
  return p.then(function(fk){
    if(fk) rec.foto=fk;
    return fetch(DB+'/'+P_INV+'.json',{method:'POST',body:JSON.stringify(rec)});
  }).then(function(r){ if(!r.ok) throw 0; return true; });
}
function nachsenden(){
  if(navigator.onLine===false) return Promise.resolve();
  return Q.alle().then(function(a){
    return Promise.all(a.map(function(j){
      return senden(j.rec, j.foto).then(function(){ return Q.weg(j.k); }).catch(function(){});
    }));
  });
}
window.addEventListener('online', function(){ nachsenden().then(function(){ laden(true).then(malen); }); });

/* ─────────────── Foto ─────────────── */
function bildLesen(datei, fertig){
  var img=new Image();
  img.onload=function(){
    var m=1400, w=img.width, hh=img.height;
    if(w>m||hh>m){ if(w>hh){ hh=Math.round(hh*m/w); w=m; } else { w=Math.round(w*m/hh); hh=m; } }
    var c=document.createElement('canvas'); c.width=w; c.height=hh;
    c.getContext('2d').drawImage(img,0,0,w,hh);
    var d=c.toDataURL('image/jpeg',0.78);
    if(d.length>1300000) d=c.toDataURL('image/jpeg',0.6);
    URL.revokeObjectURL(img.src); fertig(d);
  };
  img.onerror=function(){ URL.revokeObjectURL(img.src); fertig(null); };
  img.src=URL.createObjectURL(datei);
}

/* ─────────────── Oberfläche ─────────────── */
function malen(){
  if(!ZIEL) return;
  ZIEL.className='lg';
  ZIEL.innerHTML='<div class="lgnav">'
   +'<button id="lgB" class="'+(ANSICHT==='bestand'?'on':'')+'">'+h(t('bestand'))+'</button>'
   +'<button id="lgE" class="'+(ANSICHT==='erfassen'?'on':'')+'">'+h(t('erfassen'))+'</button>'
   +'</div><div id="lgBody"></div>';
  ZIEL.querySelector('#lgB').onclick=function(){ ANSICHT='bestand'; malen(); };
  ZIEL.querySelector('#lgE').onclick=function(){ ANSICHT='erfassen'; malen(); };
  if(ANSICHT==='bestand') malenBestand(); else malenErfassen();
}

function malenBestand(){
  var b=ZIEL.querySelector('#lgBody'), s='';
  var eng=engpaesse();
  if(eng.length){
    s+='<div class="lgeng">'+h(t('eng_titel'))+'<br>';
    eng.slice(0,6).forEach(function(x){
      s+='<b>'+h(x.artikel.name)+'</b>: '+x.bestand+' '+h(t('stueck'))+' – '
        +h(t(x.reicht===1?'reicht1':(x.reicht===0?'reicht0':'reicht'),{n:x.reicht}))+'<br>';
    });
    s+='</div>';
  } else s+='<div class="lgok">'+h(t('eng_keiner'))+'</div>';

  s+='<button class="lgpush" id="lgPush">'+h(t('push_an'))+'</button>';

  TEILE.forEach(function(def){
    var li=artikel().filter(function(a){ return a.teil===def.id; });
    if(!li.length) return;
    li.sort(function(x,y){ return (x.typ+x.serie)<(y.typ+y.serie)?-1:1; });
    s+='<h3 class="lgh">'+h(tt(def))+'</h3>';
    if(def.id==='nst') s+='<div class="lghint" style="margin:-3px 0 7px">'+h(t('zurueck'))+'</div>';
    li.forEach(function(a){
      var e=bestand(a), amp=ampel(a,e), r=reicht(a,e.bestand);
      var unter=[];
      if(e.bestand==null) unter.push(t('ungezaehlt'));
      else if(e.bestand<0) unter.push(t('negativ'));   // mehr verbraucht als gezaehlt
      else {
        if(!a.rueck && r!==null) unter.push(t(r===1?'reicht1':(r===0?'reicht0':'reicht'),{n:r}));
        if(a.bedarf) unter.push(t('bedarf',{n:a.bedarf}));
      }
      s+='<div class="lgz '+amp+'">'
       +'<span class="pkt'+(a.serie==='2026'?' n26':'')+'" style="background:'+(FARBE[a.typ]||'#999')+'"></span>'
       +'<span class="lgt"><b>'+h(a.typ+(a.serie?' · '+a.serie:' · '+t('beide')))+'</b>'
       +'<span>'+h(unter.join(' · '))+'</span></span>'
       +'<span class="lgn">'+(e.bestand==null?'–':e.bestand)
       +'<small>'+h(t('stueck'))+'</small></span></div>';
    });
  });
  var st=(MAT&&MAT.stand&&(MAT.stand.register||MAT.stand.heute))||'';
  s+='<div class="lgstand">'+h(t('basis',{q:st}))+'</div>';
  b.innerHTML=s;
  var p=b.querySelector('#lgPush'); if(p) p.onclick=function(){ pushAn(p); };
  pushStand(p);
}

function malenErfassen(){
  var b=ZIEL.querySelector('#lgBody');
  var arten=[['zaehlung'],['zugang'],['abgang']];
  var s='<label class="lgl" style="margin-top:2px">'+h(t('frage_art'))+'</label><div class="lgw">';
  arten.forEach(function(a){
    s+='<button data-a="'+a[0]+'" class="'+(eArt===a[0]?'on':'')+'" style="flex:1 1 30%">'
      +h(t('art_'+a[0]))+'<small>'+h(t('art_'+a[0]+'_h'))+'</small></button>';
  });
  s+='</div>';

  s+='<label class="lgl">'+h(t('frage_teil'))+'</label><div class="lgw" id="lgT">';
  TEILE.forEach(function(d){
    s+='<button data-t="'+d.id+'" class="'+(eTeil===d.id?'on':'')+'">'+h(tt(d))
      +'<small>'+h(tt(d,'h'))+'</small></button>';
  });
  s+='</div>';

  if(eTeil){
    var typen=typenFuer(eTeil);
    s+='<label class="lgl">'+h(t('frage_typ'))+'</label><div class="lgw typ" id="lgTy">';
    typen.forEach(function(ty){
      s+='<button data-ty="'+ty+'" class="'+(eTyp===ty?'on':'')+'" '
        +'style="border-left:7px solid '+(FARBE[ty]||'#999')+'">'+ty+'</button>';
    });
    s+='</div><div class="lghint">'+h(t('farbhilfe'))+'</div>';
  }
  if(eTeil&&eTyp){
    var ser=serienFuer(eTeil,eTyp);
    if(ser.length>1){
      s+='<label class="lgl">'+h(t('frage_serie'))+'</label><div class="lgw" id="lgSe">';
      ser.forEach(function(se){
        s+='<button data-se="'+se+'" class="'+(eSerie===se?'on':'')+'">'
          +h(se===''?t('beide'):se)+'</button>';
      });
      s+='</div>';
    } else if(eSerie===null) eSerie=ser[0];
  }
  if(eTeil&&eTyp&&eSerie!==null){
    var aSel=artikelId(eTeil,eTyp,eSerie), eSel=aSel?bestand(aSel):null;
    s+='<label class="lgl">'+h(t('frage_anzahl'))+'</label>'
     +'<div class="lgzahl"><button id="lgM">−</button>'
     +'<input id="lgN" type="number" inputmode="numeric" value="'+eAnzahl+'">'
     +'<button id="lgP">+</button></div>';
    if(eSel && eSel.bestand!=null)
      s+='<div class="lghint">'+h(t('gerechnet',{n:eSel.bestand}))
        +(eSel.basisText?' · '+h(eSel.basisText):'')+'</div>';
    else s+='<div class="lghint">'+h(t('ungezaehlt'))+'</div>';
    s+=''
     +'<label class="lgl">'+h(t('foto'))+'</label>'
     +'<input type="file" id="lgF" accept="image/*" capture="environment" style="display:none">'
     +'<button class="lgfoto" id="lgFB">'+h(eFoto?t('foto_neu'):t('foto'))
     +(eFoto?'<img src="'+eFoto+'" alt="">':'')+'</button>'
     +'<label class="lgl">'+h(t('name'))+'</label>'
     +'<input class="lgin" id="lgV" type="text" value="'+h(vonLesen())+'">'
     +'<button class="lgbtn" id="lgS">'+h(t('speichern'))+'</button>';
  }
  b.innerHTML=s;

  klick(b,'[data-a]',function(el){ eArt=el.getAttribute('data-a'); malenErfassen(); });
  klick(b,'#lgT button',function(el){ eTeil=el.getAttribute('data-t'); eTyp=null; eSerie=null; malenErfassen(); });
  klick(b,'#lgTy button',function(el){ eTyp=el.getAttribute('data-ty'); eSerie=null; malenErfassen(); });
  klick(b,'#lgSe button',function(el){ eSerie=el.getAttribute('data-se'); malenErfassen(); });
  var n=b.querySelector('#lgN');
  if(n){
    b.querySelector('#lgM').onclick=function(){ eAnzahl=Math.max(0,(+n.value||0)-1); n.value=eAnzahl; };
    b.querySelector('#lgP').onclick=function(){ eAnzahl=(+n.value||0)+1; n.value=eAnzahl; };
    n.onchange=function(){ eAnzahl=Math.max(0,+n.value||0); };
    var f=b.querySelector('#lgF');
    b.querySelector('#lgFB').onclick=function(){ f.click(); };
    f.onchange=function(){ if(f.files&&f.files[0]) bildLesen(f.files[0],function(d){ eFoto=d; malenErfassen(); }); };
    b.querySelector('#lgS').onclick=function(){ speichern(b); };
  }
}
function klick(wurzel,wahl,tun){
  var e=wurzel.querySelectorAll(wahl);
  for(var i=0;i<e.length;i++) e[i].onclick=(function(el){ return function(){ tun(el); }; })(e[i]);
}
function typenFuer(teil){
  var s={}; artikel().forEach(function(a){ if(a.teil===teil) s[a.typ]=1; });
  return Object.keys(s).sort();
}
function serienFuer(teil,typ){
  var s=[]; artikel().forEach(function(a){
    if(a.teil===teil&&a.typ===typ&&s.indexOf(a.serie)<0) s.push(a.serie); });
  return s.sort();
}
function artikelId(teil,typ,serie){
  var tr=null;
  artikel().forEach(function(a){ if(a.teil===teil&&a.typ===typ&&a.serie===serie) tr=a; });
  return tr;
}
function vonLesen(){ try{ return localStorage.getItem(LS_VON)||''; }catch(e){ return ''; } }
function heute(){ var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

function speichern(b){
  var von=(b.querySelector('#lgV').value||'').trim();
  var anz=+b.querySelector('#lgN').value||0;
  var a=artikelId(eTeil,eTyp,eSerie);
  if(!a || anz<0 || (eArt!=='zaehlung' && anz<=0)){ alert(t('fehlt_teil')); return; }
  if(!von){ alert(t('fehlt_name')); return; }
  try{ localStorage.setItem(LS_VON,von); }catch(e){}
  var rec={ art:eArt, artikel:a.id, teil:eTeil, typ:eTyp, serie:eSerie, anzahl:anz,
            von:von, datum:heute(), ts:Date.now(), quelle:'lager' };
  var foto=eFoto;
  INV.push(JSON.parse(JSON.stringify(rec)));                    // sofort sichtbar
  var e=bestand(a);
  senden(rec,foto).then(function(){
    meldung(t('gespeichert',{n:e.bestand}));
  }).catch(function(){
    Q.add({rec:rec, foto:foto}); meldung(t('wartet'));
  }).then(function(){
    eAnzahl=0; eFoto=null; ANSICHT='bestand'; malen();
  });
}
function meldung(txt){
  var d=document.createElement('div');
  d.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99;'
   +'background:#1a1a1a;color:#fff;padding:12px 18px;border-radius:11px;font:800 14.5px '
   +'-apple-system,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:90%;';
  d.textContent=txt; document.body.appendChild(d);
  setTimeout(function(){ d.remove(); },3200);
}

/* ─────────────── Zusatzteile beim Bergtransport ─────────────── */
/* Quertraversen und alles andere, was mit hochgeht, verlassen das Lager erst hier
   (Entscheid Victor 20.08.2026) - darum beim Melden «auf den Berg» erfassbar. */
function mitFormular(div){
  if(!MAT){ laden().then(function(){ mitFormular(div); }); return; }
  if(!mitZeilen.length) mitZeilen=[{teil:'qt', typ:'', serie:'', anzahl:1}];
  stil();
  div.className='lg';
  var s='<label class="lgl" style="margin-top:6px">'+h(t('mit_titel'))+'</label>'
   +'<div class="lghint" style="margin:0 0 8px">'+h(t('mit_hilfe'))+'</div>';
  mitZeilen.forEach(function(z,i){
    s+='<div class="lgmit"><div class="kopf">'
     +'<select data-i="'+i+'" data-f="teil">';
    TEILE.forEach(function(d){ s+='<option value="'+d.id+'"'+(z.teil===d.id?' selected':'')+'>'+h(tt(d))+'</option>'; });
    s+='</select><select data-i="'+i+'" data-f="ts"><option value="">Typ …</option>';
    artikel().filter(function(a){ return a.teil===z.teil; })
      .sort(function(x,y){ return (x.typ+x.serie)<(y.typ+y.serie)?-1:1; })
      .forEach(function(a){
        var w=a.typ+'|'+a.serie;
        s+='<option value="'+w+'"'+(z.typ===a.typ&&z.serie===a.serie?' selected':'')+'>'
          +h(a.typ+(a.serie?' '+a.serie:' '+t('beide')))+'</option>';
      });
    s+='</select><input type="number" inputmode="numeric" min="1" value="'+(z.anzahl||1)
     +'" data-i="'+i+'" data-f="anzahl">'
     +'</div>'+(mitZeilen.length>1?'<button class="weg" data-weg="'+i+'">'+h(t('entfernen'))+'</button>':'')
     +'</div>';
  });
  s+='<button class="lgplus" id="lgMehr">'+h(t('mit_zeile'))+'</button>';
  div.innerHTML=s;
  klick(div,'[data-weg]',function(el){ mitZeilen.splice(+el.getAttribute('data-weg'),1); mitFormular(div); });
  div.querySelector('#lgMehr').onclick=function(){ mitZeilen.push({teil:'qt',typ:'',serie:'',anzahl:1}); mitFormular(div); };
  var sel=div.querySelectorAll('select,input');
  for(var i=0;i<sel.length;i++) sel[i].onchange=(function(el){ return function(){
    var i=+el.getAttribute('data-i'), f=el.getAttribute('data-f'), z=mitZeilen[i];
    if(f==='teil'){ z.teil=el.value; z.typ=''; z.serie=''; mitFormular(div); }
    else if(f==='ts'){ var p=el.value.split('|'); z.typ=p[0]||''; z.serie=p[1]||''; }
    else z.anzahl=Math.max(1,+el.value||1);
  }; })(sel[i]);
}
/* schreibt die erfassten Zeilen als Abgänge; tischIds nur zur Nachvollziehbarkeit */
function mitSpeichern(tischIds, von){
  var jobs=[];
  mitZeilen.forEach(function(z){
    if(!z.teil || !z.typ || !z.anzahl) return;
    var a=artikelId(z.teil, z.typ, z.serie);
    if(!a) return;
    jobs.push({ art:'abgang', artikel:a.id, teil:z.teil, typ:z.typ, serie:z.serie,
                anzahl:z.anzahl, von:von||'', datum:heute(), ts:Date.now(),
                quelle:'berg', tische:(tischIds||[]).join(',') });
  });
  mitZeilen=[];
  if(!jobs.length) return Promise.resolve(0);
  return Promise.all(jobs.map(function(r){
    if(INV) INV.push(JSON.parse(JSON.stringify(r)));
    return senden(r,null).catch(function(){ return Q.add({rec:r,foto:null}); });
  })).then(function(){ return jobs.length; });
}

/* ─────────────── Warnung aufs Handy (Web Push) ─────────────── */
/* Der öffentliche VAPID-Schlüssel wird von Tools\Push_Schluessel.py erzeugt und
   liegt in uploads/push.json; der private Schlüssel bleibt auf Victors Rechner. */
var PUSH=null;
function pushKonfig(){ if(PUSH) return Promise.resolve(PUSH);
  return jget('uploads/push.json').then(function(j){ PUSH=j; return j; }); }
function pushMoeglich(){ return !!(window.Notification && navigator.serviceWorker && window.PushManager); }
function swBereit(){                       // Registrierung anstossen, sonst wartet .ready ewig
  try{ navigator.serviceWorker.register('sw.js').catch(function(){}); }catch(e){}
  return navigator.serviceWorker.ready;
}
function pushStand(knopf){
  if(!knopf) return;
  knopf.style.display='none';
  if(!pushMoeglich()) return;
  pushKonfig().then(function(cfg){
    if(!cfg||!cfg.vapid) return;                    // ohne Schluessel keinen Knopf zeigen
    knopf.style.display='';
    return swBereit().then(function(reg){ return reg.pushManager.getSubscription(); })
      .then(function(s){ if(s){ knopf.classList.add('an'); knopf.textContent=t('push_aus'); } });
  }).catch(function(){});
}
function b64url(s){
  var p='='.repeat((4-s.length%4)%4), b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));
  var a=new Uint8Array(b.length); for(var i=0;i<b.length;i++) a[i]=b.charCodeAt(i); return a;
}
function pushAn(knopf){
  if(!pushMoeglich()){ alert(t('push_geht_nicht')); return; }
  pushKonfig().then(function(cfg){
    if(!cfg||!cfg.vapid){ alert(t('push_geht_nicht')); return; }
    return Notification.requestPermission().then(function(r){
      if(r!=='granted'){ alert(t('push_nein')); return; }
      return swBereit().then(function(reg){
        return reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64url(cfg.vapid)});
      }).then(function(sub){
        var j=sub.toJSON();
        return fetch(DB+'/erfassung/push_abos.json',{method:'POST',body:JSON.stringify({
          endpoint:j.endpoint, p256dh:j.keys&&j.keys.p256dh, auth:j.keys&&j.keys.auth,
          von:vonLesen(), datum:heute(), ts:Date.now(), thema:'normteile'
        })});
      }).then(function(){
        knopf.classList.add('an'); knopf.textContent=t('push_aus'); meldung(t('push_ok'));
      });
    });
  }).catch(function(){ alert(t('push_geht_nicht')); });
}

/* ─────────────── Einstieg ─────────────── */
window.NalpLager={
  start:function(div){
    ZIEL=div; stil();
    div.className='lg';
    div.innerHTML='<div class="lghint">'+h(t('laden'))+'</div>';
    nachsenden();
    laden().then(function(){
      if(!MAT){ div.innerHTML='<div class="lgeng">'+h(t('fehler'))+'</div>'; return; }
      malen();
    });
  },
  sprache:function(l){ if(T[l]) L=l; if(ZIEL&&MAT) malen(); },
  neuLaden:function(){ return laden(true); },
  mitFormular:mitFormular,
  mitSpeichern:mitSpeichern,
  mitLeeren:function(){ mitZeilen=[]; },
  engpaesse:function(){ return MAT?engpaesse():[]; },
  bestandVon:function(id){ var a=null;
    artikel().forEach(function(x){ if(x.id===id) a=x; });
    return a?bestand(a):null; },
  artikel:artikel,
  laden:laden
};
})();
