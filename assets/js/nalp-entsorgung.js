/* nalp-entsorgung.js — «Darf das weg?» für den Installationsplatz Tal
 *
 * Beantwortet zwei Fragen, ohne dass jemand eine Liste durchsuchen muss:
 *   1. Passstück (Etikett Mauchle, z.B. «995-S1-2724»): wird es noch gebraucht?
 *   2. Normteil (Traverse, Knieträger, Normstütze Berg/Tal): bleibt es hier,
 *      geht es zurück nach Sursee oder darf es entsorgt werden?
 *
 * Grundsatz (V. Malt 19.08.2026): nur was belegt überzählig ist, darf weg.
 * Alles Unklare bleibt liegen und wird gemeldet – lieber ein Stück zu viel
 * aufbewahren als ein gebrauchtes verschrotten.
 *
 * Datenquellen
 *   uploads/entsorgung_regeln.json      Regeln je Normteil + Sonderfälle (von Hand gepflegt)
 *   assets/js/nalp-passstueck-daten.js  Bestellhistorie Mauchle Batch 1–16 (gueltig 1/0)
 *
 * Einbau:  NalpEntsorgung.start(divElement)   ·  NalpEntsorgung.sprache('de'|'en'|'pl')
 * Beides funktioniert offline (Dateien liegen im Service-Worker-Precache).
 */
(function(){
'use strict';

var DB   = 'https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app';
var PFAD = 'erfassung/entsorgung_fragen';           // Meldungen bei Unklarheiten
var LS_VON = 'nalp_erfasser_v1';                    // gleicher Name wie in vormontage.html
var LS_Q   = 'nalp_entsorgung_pending_v1';          // Warteschlange, wenn kein Netz

var L = 'de', ZIEL = null, REG = null, MODUS = 'ps', LETZTES = null;
var nTeil = null, nSerie = null;                    // Auswahl im Normteil-Modus

/* ─────────────────────────── Texte ─────────────────────────── */
var T = {
 de:{
  titel:'♻️ Darf das weg?',
  sub:'Erst fragen, dann verladen. Was hier nicht als überzählig steht, bleibt liegen.',
  m_ps:'🏷 Passstück', m_nt:'🔩 Normteil',
  ps_frage:'Nummer vom Etikett eintippen',
  ps_ph:'z.B. 995-S1-2724',
  ps_hilfe:'Auf dem Mauchle-Etikett steht «Position». Es geht auch nur die Tischnummer – dann kommt die ganze Liste zum Tisch.',
  pruefen:'Prüfen',
  erkannt:'Erkannt',
  tisch:'Tisch', stuetze:'Stütze', laenge:'Länge',
  nt_frage:'Welches Teil?',
  nt_serie:'Welche Serie?',
  s2025:'2025 – reine Farbe', s2026:'2026 – weisser Strich', sweiss:'weiss nicht',
  farbhilfe:'Farbe = Typ: blau A · rot B · grau C · grün D · gelb E. Weisser Strich = Serie 2026.',
  keine_eingabe:'Bitte die Nummer vom Etikett eintippen.',
  keine_zahl:'Daraus kann ich keine Tischnummer lesen.',
  laden:'Daten werden geladen …',
  fehler_daten:'Die Bestelldaten liessen sich nicht laden. Bitte Bauleitung fragen.',
  tab_pos:'Position', tab_soll:'Gebraucht', tab_alt:'Überholt',
  tisch_liste:'Alle Stützen von Tisch',
  kein_treffer_laenge:'Zu dieser Länge gibt es keine Bestellung für {pos}.',
  falsche_stuetze:'Achtung: {len} mm gehört zu {pos2}, nicht zu {pos}. Etikett prüfen – bei Tisch 1746 waren die Kleber schon einmal vertauscht.',
  kein_tisch:'Zu Tisch {t} steht keine Passstück-Bestellung in der Liste.',
  typ:'Typ',
  quelle:'Quelle',
  melden:'📣 Melden',
  melden_titel:'Der Bauleitung melden',
  name:'Dein Name',
  bem:'Was ist unklar?',
  senden:'Senden', abbrechen:'Abbrechen',
  gesendet:'Gemeldet. Danke – bitte das Teil stehen lassen.',
  gespeichert:'Kein Netz – die Meldung geht automatisch raus, sobald du wieder online bist.',
  name_fehlt:'Bitte den Namen eintragen.',
  neu:'Nächstes Teil',
  stand:'Regeln vom'
 },
 en:{
  titel:'♻️ Can this go?',
  sub:'Ask first, load later. Anything not listed as surplus stays here.',
  m_ps:'🏷 Fitting piece', m_nt:'🔩 Standard part',
  ps_frage:'Type the number from the label',
  ps_ph:'e.g. 995-S1-2724',
  ps_hilfe:'The Mauchle label says «Position». The table number alone also works – you then get the whole list for that table.',
  pruefen:'Check',
  erkannt:'Read as',
  tisch:'Table', stuetze:'Post', laenge:'Length',
  nt_frage:'Which part?',
  nt_serie:'Which series?',
  s2025:'2025 – plain colour', s2026:'2026 – white stripe', sweiss:'not sure',
  farbhilfe:'Colour = type: blue A · red B · grey C · green D · yellow E. White stripe = series 2026.',
  keine_eingabe:'Please type the number from the label.',
  keine_zahl:'I cannot read a table number from that.',
  laden:'Loading data …',
  fehler_daten:'Order data could not be loaded. Please ask site management.',
  tab_pos:'Position', tab_soll:'Needed', tab_alt:'Superseded',
  tisch_liste:'All posts of table',
  kein_treffer_laenge:'No order with this length for {pos}.',
  falsche_stuetze:'Careful: {len} mm belongs to {pos2}, not to {pos}. Check the label – labels were swapped once on table 1746.',
  kein_tisch:'No fitting piece order on file for table {t}.',
  typ:'Type',
  quelle:'Source',
  melden:'📣 Report',
  melden_titel:'Report to site management',
  name:'Your name',
  bem:'What is unclear?',
  senden:'Send', abbrechen:'Cancel',
  gesendet:'Reported. Thanks – please leave the part where it is.',
  gespeichert:'No connection – the report is sent automatically once you are online.',
  name_fehlt:'Please enter your name.',
  neu:'Next part',
  stand:'Rules dated'
 },
 pl:{
  titel:'♻️ Czy to może iść?',
  sub:'Najpierw zapytaj, potem ładuj. Co nie jest tu wpisane jako zbędne, zostaje.',
  m_ps:'🏷 Element pasowany', m_nt:'🔩 Część standardowa',
  ps_frage:'Wpisz numer z etykiety',
  ps_ph:'np. 995-S1-2724',
  ps_hilfe:'Na etykiecie Mauchle jest «Position». Wystarczy też sam numer stołu – wtedy pokaże się cała lista.',
  pruefen:'Sprawdź',
  erkannt:'Odczytano',
  tisch:'Stół', stuetze:'Podpora', laenge:'Długość',
  nt_frage:'Która część?',
  nt_serie:'Która seria?',
  s2025:'2025 – czysty kolor', s2026:'2026 – biały pasek', sweiss:'nie wiem',
  farbhilfe:'Kolor = typ: niebieski A · czerwony B · szary C · zielony D · żółty E. Biały pasek = seria 2026.',
  keine_eingabe:'Wpisz numer z etykiety.',
  keine_zahl:'Nie mogę odczytać numeru stołu.',
  laden:'Wczytywanie danych …',
  fehler_daten:'Nie udało się wczytać danych zamówień. Zapytaj kierownictwo.',
  tab_pos:'Pozycja', tab_soll:'Potrzebne', tab_alt:'Nieaktualne',
  tisch_liste:'Wszystkie podpory stołu',
  kein_treffer_laenge:'Brak zamówienia z tą długością dla {pos}.',
  falsche_stuetze:'Uwaga: {len} mm należy do {pos2}, nie do {pos}. Sprawdź etykietę – przy stole 1746 były już zamienione.',
  kein_tisch:'Brak zamówienia elementu dla stołu {t}.',
  typ:'Typ',
  quelle:'Źródło',
  melden:'📣 Zgłoś',
  melden_titel:'Zgłoś kierownictwu budowy',
  name:'Twoje imię i nazwisko',
  bem:'Co jest niejasne?',
  senden:'Wyślij', abbrechen:'Anuluj',
  gesendet:'Zgłoszono. Dziękujemy – zostaw element na miejscu.',
  gespeichert:'Brak sieci – zgłoszenie wyjdzie automatycznie po połączeniu.',
  name_fehlt:'Wpisz imię i nazwisko.',
  neu:'Następna część',
  stand:'Zasady z dnia'
 }
};
function t(k,p){
  var s = (T[L]&&T[L][k]) || T.de[k] || k;
  if(p) for(var x in p) s = s.split('{'+x+'}').join(p[x]);
  return s;
}
function txt(o,feld){                      // Regeltexte tragen de/en/pl direkt am Objekt
  if(!o) return '';
  return o[feld?(feld+'_'+L):L] || o[feld?(feld+'_de'):'de'] || '';
}

/* ─────────────────────────── Stil ─────────────────────────── */
var CSS = ''
+'.ez{--gr:#1e9e5a;--bl:#1565c0;--ro:#D72622;--ge:#e08a00;}'
+'.ez .ezmod{display:flex;gap:8px;margin-bottom:12px;}'
+'.ez .ezmod button{flex:1;border:1.5px solid #d7dade;background:#fff;color:#1a1a1a;font:inherit;'
 +'font-size:15px;font-weight:800;padding:13px 6px;border-radius:12px;cursor:pointer;}'
+'.ez .ezmod button.on{background:#1a1a1a;border-color:#1a1a1a;color:#fff;}'
+'.ez .ezmerk{background:#0f1b2a;color:#fff;border-radius:12px;padding:13px 15px;'
 +'font-size:15.5px;font-weight:800;line-height:1.35;margin-bottom:14px;}'
+'.ez label.ezl{display:block;font-size:14px;font-weight:800;margin:2px 0 6px;}'
+'.ez .ezhelp{font-size:12.5px;color:#63676d;margin:6px 0 12px;line-height:1.35;}'
+'.ez input.ezin{width:100%;font:inherit;font-size:22px;font-weight:800;letter-spacing:.5px;'
 +'padding:14px 12px;border:1.5px solid #d7dade;border-radius:12px;background:#fff;}'
+'.ez .ezbtn{width:100%;border:0;background:#D72622;color:#fff;font:inherit;font-size:17px;'
 +'font-weight:900;padding:15px;border-radius:12px;margin-top:10px;cursor:pointer;}'
+'.ez .ezwahl{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}'
+'.ez .ezwahl button{flex:1 1 46%;border:1.5px solid #d7dade;background:#fff;color:#1a1a1a;'
 +'font:inherit;font-size:14.5px;font-weight:800;padding:14px 8px;border-radius:12px;text-align:left;cursor:pointer;}'
+'.ez .ezwahl button.on{border-color:#1a1a1a;border-width:2.5px;background:#f3f5f7;}'
+'.ez .ezwahl button small{display:block;font-weight:600;font-size:11.5px;color:#63676d;margin-top:3px;}'
+'.ez .ezamp{border-radius:14px;padding:18px 16px;color:#fff;margin:14px 0 0;}'
+'.ez .ezamp.gruen{background:#1e9e5a;}.ez .ezamp.blau{background:#1565c0;}'
+'.ez .ezamp.rot{background:#D72622;}.ez .ezamp.gelb{background:#e08a00;}'
+'.ez .ezamp .eza{font-size:26px;font-weight:900;line-height:1.15;}'
+'.ez .ezamp .ezw{font-size:15px;font-weight:700;margin-top:6px;opacity:.95;}'
+'.ez .ezerg{border:1.5px solid #e3e5e8;border-top:0;border-radius:0 0 14px 14px;'
 +'background:#fff;padding:13px 15px;font-size:14px;line-height:1.45;}'
+'.ez .ezerg b{font-weight:800;}'
+'.ez .ezwarn{background:#fff6e5;border-left:4px solid #e08a00;padding:10px 12px;'
 +'border-radius:8px;margin-top:10px;font-size:13.5px;}'
+'.ez .ezq{font-size:11.5px;color:#63676d;margin-top:12px;line-height:1.35;}'
+'.ez table.ezt{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;}'
+'.ez table.ezt th{text-align:left;font-size:11.5px;color:#63676d;text-transform:uppercase;'
 +'letter-spacing:.4px;padding:4px 6px;border-bottom:1px solid #e3e5e8;}'
+'.ez table.ezt td{padding:8px 6px;border-bottom:1px solid #f0f1f3;}'
+'.ez table.ezt tr.hl td{background:#fffbe6;font-weight:800;}'
+'.ez table.ezt .ok{color:#1e9e5a;font-weight:800;}'
+'.ez table.ezt .alt{color:#9aa0a6;text-decoration:line-through;}'
+'.ez .ezfoot{display:flex;gap:8px;margin-top:14px;}'
+'.ez .ezfoot button{flex:1;border:1.5px solid #d7dade;background:#fff;font:inherit;font-size:15px;'
 +'font-weight:800;padding:13px 8px;border-radius:12px;cursor:pointer;}'
+'.ez .ezfoot button.warn{background:#e08a00;border-color:#e08a00;color:#fff;}'
+'.ez .ezmeld{border:1.5px solid #e3e5e8;border-radius:12px;padding:13px;margin-top:12px;background:#fafbfc;}'
+'.ez .ezmeld input,.ez .ezmeld textarea{width:100%;font:inherit;font-size:15px;padding:11px;'
 +'border:1.5px solid #d7dade;border-radius:10px;margin-bottom:9px;background:#fff;}'
+'.ez .ezmeld textarea{min-height:74px;}'
+'.ez .ezstand{font-size:11.5px;color:#63676d;margin-top:16px;text-align:center;}';

function stilSetzen(){
  if(document.getElementById('ezStil')) return;
  var s=document.createElement('style'); s.id='ezStil'; s.textContent=CSS;
  document.head.appendChild(s);
}

/* ─────────────────────── Daten nachladen ─────────────────────── */
function regelnLaden(){
  if(REG) return Promise.resolve(REG);
  return fetch('uploads/entsorgung_regeln.json',{cache:'no-store'})
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(j){ REG=j; return j; })
    .catch(function(){ return null; });
}
function psDatenLaden(){
  if(window.NALP_PS_DATEN) return Promise.resolve(window.NALP_PS_DATEN);
  return new Promise(function(ok){
    var s=document.createElement('script');
    s.src='assets/js/nalp-passstueck-daten.js';
    s.onload=function(){ ok(window.NALP_PS_DATEN||null); };
    s.onerror=function(){ ok(null); };
    document.head.appendChild(s);
  });
}

/* ─────────────────────── Etikett lesen ─────────────────────── */
/* «Position 995-S1-2724», «995 S1 2724», «1062-S3», «1062» */
function etikettLesen(roh){
  var s=(roh||'').toUpperCase();
  var m=s.match(/(\d{1,4})\s*[-_.\/ ]\s*S\s*([1-4])(?:\s*[-_.\/ ]\s*(\d{2,5}))?/);
  if(m) return { tisch:+m[1], stuetze:'S'+m[2], laenge:m[3]?+m[3]:null };
  var zahlen=(s.match(/\d+/g)||[]).map(Number);
  var st=s.match(/S\s*([1-4])\b/);
  if(st){                                        // Stütze genannt, Zahlen drumherum sortieren
    var ohne=zahlen.filter(function(z){ return z!==+st[1]; });
    return { tisch:ohne.length?ohne[0]:null, stuetze:'S'+st[1],
             laenge:ohne.length>1?ohne[ohne.length-1]:null };
  }
  if(!zahlen.length) return null;
  if(zahlen.length===1) return { tisch:zahlen[0], stuetze:null, laenge:null };
  return { tisch:zahlen[0], stuetze:null, laenge:zahlen[zahlen.length-1] };
}

/* ─────────────────────── Prüflogik Passstück ─────────────────────── */
/* bestellungen: [tisch, stuetze, laenge_mm, batch, datum, bauteilart, gueltig] */
function positionen(tisch){
  var d=window.NALP_PS_DATEN;
  if(!d||!d.bestellungen) return [];
  return d.bestellungen.filter(function(b){ return +b[0]===+tisch; });
}
function tischInfo(tisch){
  var d=window.NALP_PS_DATEN;
  if(!d||!d.zonen) return null;
  var sp=d.spalten, iT=sp.indexOf('nalpi_typ'), iP=sp.indexOf('bauphase'), iId=sp.indexOf('id');
  for(var z in d.zonen){
    var r=d.zonen[z].tische;
    for(var i=0;i<r.length;i++) if(+r[i][iId]===+tisch)
      return { zone:z, typ:r[i][iT], phase:r[i][iP] };
  }
  return null;
}
function pruefePassstueck(tisch, stuetze, laenge){
  var tol=(REG&&REG.toleranz_mm)||2, warn=(REG&&REG.warn_mm)||20;
  var alle=positionen(tisch);
  var erg={ tisch:tisch, stuetze:stuetze, laenge:laenge, alle:alle,
            info:tischInfo(tisch), warnungen:[] };

  var sf=sonderfall(tisch,stuetze,laenge);
  if(sf){ erg.aktion=sf.aktion; erg.text=txt(sf); erg.quelle=sf.quelle; erg.sonderfall=true; return erg; }

  if(!alle.length){
    erg.aktion=(REG&&REG.passstueck.unbekannt.aktion)||'fragen';
    erg.text=t('kein_tisch',{t:tisch});
    erg.quelle=REG?REG.passstueck.unbekannt.quelle:'';
    return erg;
  }
  if(!stuetze || laenge===null || laenge===undefined){ erg.aktion=null; return erg; }  // nur Liste zeigen

  var pos=alle.filter(function(b){ return b[1]===stuetze; });
  var treffer=null;
  for(var i=0;i<pos.length;i++) if(Math.abs(Math.round(pos[i][2])-laenge)<=tol){ treffer=pos[i]; break; }

  if(treffer){
    var r=REG.passstueck[treffer[6]===1?'gueltig':'ersetzt'];
    erg.aktion=r.aktion; erg.text=txt(r); erg.quelle=r.quelle; erg.zeile=treffer;
    if(treffer[6]===0){
      var neu=pos.filter(function(b){ return b[6]===1; })[0];
      if(neu && laenge>Math.round(neu[2])){
        erg.warnungen.push(txt(REG.passstueck.laenger_hinweis));
        erg.aktion='fragen';                       // längeres Altstück kann Reserve-Rohling sein
      }
    }
    return erg;
  }

  /* Länge passt nicht zur genannten Stütze – gehört sie zu einer anderen? */
  var andere=alle.filter(function(b){
    return b[1]!==stuetze && Math.abs(Math.round(b[2])-laenge)<=tol; });
  erg.aktion=REG.passstueck.unbekannt.aktion;
  erg.text=t('kein_treffer_laenge',{pos:tisch+'-'+stuetze});
  erg.quelle=REG.passstueck.unbekannt.quelle;
  if(andere.length) erg.warnungen.push(t('falsche_stuetze',
    {len:laenge, pos:tisch+'-'+stuetze, pos2:tisch+'-'+andere[0][1]}));
  else {
    var nah=pos.filter(function(b){ return Math.abs(Math.round(b[2])-laenge)<=warn; });
    if(nah.length) erg.warnungen.push(laenge+' mm ≠ '+Math.round(nah[0][2])+' mm ('
      +Math.abs(laenge-Math.round(nah[0][2]))+' mm)');
  }
  return erg;
}
function sonderfall(tisch, stuetze, laenge){
  var li=(REG&&REG.sonderfaelle)||[];
  for(var i=0;i<li.length;i++){
    var s=li[i];
    if(+s.tisch!==+tisch) continue;
    if(s.stuetze && stuetze && s.stuetze!==stuetze) continue;
    if(s.laenge && laenge && Math.abs(s.laenge-laenge)>2) continue;
    return s;
  }
  return null;
}

/* ─────────────────────── Oberfläche ─────────────────────── */
function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function malen(){
  if(!ZIEL) return;
  ZIEL.className='ez';
  ZIEL.innerHTML=''
   +'<div class="ezmod">'
   +'<button id="ezMps" class="'+(MODUS==='ps'?'on':'')+'">'+h(t('m_ps'))+'</button>'
   +'<button id="ezMnt" class="'+(MODUS==='nt'?'on':'')+'">'+h(t('m_nt'))+'</button>'
   +'</div>'
   +'<div id="ezBody"></div>'
   +'<div id="ezErg"></div>'
   +(REG?'<div class="ezstand">'+h(t('stand'))+' '+h(REG.stand)+'</div>':'');
  ZIEL.querySelector('#ezMps').onclick=function(){ MODUS='ps'; LETZTES=null; malen(); };
  ZIEL.querySelector('#ezMnt').onclick=function(){ MODUS='nt'; LETZTES=null; malen(); };
  if(MODUS==='ps') malenPs(); else malenNt();
}

function malenPs(){
  var b=ZIEL.querySelector('#ezBody');
  b.innerHTML=''
   +'<label class="ezl" for="ezPs">'+h(t('ps_frage'))+'</label>'
   +'<input class="ezin" id="ezPs" type="text" inputmode="text" autocomplete="off" '
     +'spellcheck="false" placeholder="'+h(t('ps_ph'))+'">'
   +'<div class="ezhelp">'+h(t('ps_hilfe'))+'</div>'
   +'<button class="ezbtn" id="ezPsGo">'+h(t('pruefen'))+'</button>';
  var inp=b.querySelector('#ezPs');
  b.querySelector('#ezPsGo').onclick=function(){ psPruefen(inp.value); };
  inp.addEventListener('keydown',function(e){ if(e.key==='Enter') psPruefen(inp.value); });
  inp.focus();
}

function psPruefen(roh){
  var ziel=ZIEL.querySelector('#ezErg');
  if(!roh || !roh.trim()){ ziel.innerHTML=hinweisBox(t('keine_eingabe')); return; }
  var e=etikettLesen(roh);
  if(!e || !e.tisch){ ziel.innerHTML=hinweisBox(t('keine_zahl')); return; }
  ziel.innerHTML='<div class="ezhelp">'+h(t('laden'))+'</div>';
  psDatenLaden().then(function(d){
    if(!d){ ziel.innerHTML=hinweisBox(t('fehler_daten')); return; }
    var erg=pruefePassstueck(e.tisch, e.stuetze, e.laenge);
    LETZTES={ art:'passstueck', eingabe:roh, gelesen:e, aktion:erg.aktion };
    ziel.innerHTML=ergPs(erg);
    knoepfe(ziel);
  });
}

function ergPs(e){
  var s='';
  if(e.aktion){
    var a=REG.aktionen[e.aktion];
    s+='<div class="ezamp '+a.farbe+'">'
      +'<div class="eza">'+h(txt(a))+'</div>'
      +'<div class="ezw">'+h(t('tisch'))+' '+e.tisch
        +(e.stuetze?' · '+e.stuetze:'')
        +(e.laenge?' · '+e.laenge+' mm':'')+'</div></div>'
      +'<div class="ezerg">'+h(e.text||'');
    for(var i=0;i<e.warnungen.length;i++) s+='<div class="ezwarn">⚠️ '+h(e.warnungen[i])+'</div>';
    if(e.zeile) s+='<div class="ezq">Batch '+h(e.zeile[3])+' · '+h(e.zeile[4])
      +' · '+h(e.zeile[5])+' · '+Math.round(e.zeile[2])+' mm</div>';
    if(e.quelle) s+='<div class="ezq">'+h(t('quelle'))+': '+h(e.quelle)+'</div>';
    s+='</div>';
  }
  if(e.alle && e.alle.length){
    var inf=e.info?(' · '+h(t('typ'))+' '+h(e.info.typ||'?')):'';
    s+='<table class="ezt"><thead><tr><th colspan="4">'+h(t('tisch_liste'))+' '+e.tisch+inf
      +'</th></tr><tr><th>'+h(t('stuetze'))+'</th><th>'+h(t('laenge'))+'</th>'
      +'<th>Batch</th><th></th></tr></thead><tbody>';
    var sort=e.alle.slice().sort(function(a,b){
      return a[1]===b[1] ? b[6]-a[6] : (a[1]<b[1]?-1:1); });
    for(var j=0;j<sort.length;j++){
      var r=sort[j], gilt=r[6]===1;
      var hl=(e.stuetze===r[1] && e.laenge && Math.abs(Math.round(r[2])-e.laenge)<=((REG&&REG.toleranz_mm)||2));
      s+='<tr class="'+(hl?'hl':'')+'"><td>'+h(r[1])+'</td>'
        +'<td class="'+(gilt?'ok':'alt')+'">'+Math.round(r[2])+' mm</td>'
        +'<td>'+h(r[3])+'</td>'
        +'<td>'+(gilt?'<span class="ok">'+h(t('tab_soll'))+'</span>':'<span style="color:#9aa0a6">'+h(t('tab_alt'))+'</span>')+'</td></tr>';
    }
    s+='</tbody></table>';
  }
  return s;
}

function malenNt(){
  var b=ZIEL.querySelector('#ezBody');
  var teile=(REG&&REG.normteile)||[];
  var s='';
  if(REG&&REG.merksatz) s+='<div class="ezmerk">'+h(txt(REG.merksatz))+'</div>';
  s+='<label class="ezl">'+h(t('nt_frage'))+'</label><div class="ezwahl" id="ezT">';
  for(var i=0;i<teile.length;i++){
    s+='<button data-i="'+i+'" class="'+(nTeil===i?'on':'')+'">'+h(txt(teile[i]))
      +'<small>'+h(txt(teile[i],'hilfe'))+'</small></button>';
  }
  s+='</div>';
  if(nTeil!==null){
    var ser=teile[nTeil].serien;
    if(ser.alle){ nSerie='alle'; }
    else{
      s+='<label class="ezl">'+h(t('nt_serie'))+'</label><div class="ezwahl" id="ezS">'
       +'<button data-s="2025" class="'+(nSerie==='2025'?'on':'')+'">'+h(t('s2025'))+'</button>'
       +'<button data-s="2026" class="'+(nSerie==='2026'?'on':'')+'">'+h(t('s2026'))+'</button>'
       +'<button data-s="?" class="'+(nSerie==='?'?'on':'')+'">'+h(t('sweiss'))+'</button>'
       +'</div><div class="ezhelp">'+h(t('farbhilfe'))+'</div>';
    }
  }
  b.innerHTML=s;
  var tb=b.querySelectorAll('#ezT button');
  for(var k=0;k<tb.length;k++) tb[k].onclick=function(){
    nTeil=+this.getAttribute('data-i'); nSerie=null; malenNt(); ntErgebnis(); };
  var sb=b.querySelectorAll('#ezS button');
  for(var m=0;m<sb.length;m++) sb[m].onclick=function(){
    nSerie=this.getAttribute('data-s'); malenNt(); ntErgebnis(); };
  ntErgebnis();
}

function ntErgebnis(){
  var ziel=ZIEL.querySelector('#ezErg'); ziel.innerHTML='';
  if(nTeil===null || !nSerie) return;
  var teil=REG.normteile[nTeil];
  var r = teil.serien.alle || teil.serien[nSerie];
  if(!r){                                          // «weiss nicht» → sicherste Antwort der beiden
    var kand=[teil.serien['2025'], teil.serien['2026']].filter(Boolean);
    var alleGleich = kand.length===2 && kand[0].aktion===kand[1].aktion;
    r = alleGleich ? kand[0] : { aktion:'fragen',
        de:'Ohne Serie lässt sich das nicht sagen. Weisser Strich = 2026, reine Farbe = 2025. Wenn unklar: melden.',
        en:'Cannot say without the series. White stripe = 2026, plain colour = 2025. If unclear: report.',
        pl:'Bez serii nie da się tego ocenić. Biały pasek = 2026, czysty kolor = 2025. W razie wątpliwości: zgłoś.',
        quelle:'Grundsatz: im Zweifel bleibt alles liegen' };
  }
  var a=REG.aktionen[r.aktion];
  var s='<div class="ezamp '+a.farbe+'"><div class="eza">'+h(txt(a))+'</div>'
   +'<div class="ezw">'+h(txt(teil))+(nSerie==='2025'||nSerie==='2026'?' · '+nSerie:'')+'</div></div>'
   +'<div class="ezerg">'+h(txt(r));
  var hw=txt(r,'hinweis');
  if(hw) s+='<div class="ezwarn">ℹ️ '+h(hw)+'</div>';
  if(r.quelle) s+='<div class="ezq">'+h(t('quelle'))+': '+h(r.quelle)+'</div>';
  s+='</div>';
  ziel.innerHTML=s;
  LETZTES={ art:'normteil', teil:teil.id, serie:nSerie, aktion:r.aktion };
  knoepfe(ziel);
}

/* schlichter Hinweis, wenn die Eingabe nicht lesbar ist – keine Ampel */
function hinweisBox(s){ return '<div class="ezwarn" style="margin-top:14px">⚠️ '+h(s)+'</div>'; }

function knoepfe(ziel){
  var d=document.createElement('div');
  d.className='ezfoot';
  d.innerHTML='<button class="warn" id="ezMeld">'+h(t('melden'))+'</button>'
   +'<button id="ezNeu">'+h(t('neu'))+'</button>';
  ziel.appendChild(d);
  d.querySelector('#ezMeld').onclick=function(){ meldeFormular(ziel); };
  d.querySelector('#ezNeu').onclick=function(){ nTeil=null; nSerie=null; LETZTES=null; malen(); };
}

/* ─────────────────────── Melden ─────────────────────── */
function meldeFormular(ziel){
  if(ziel.querySelector('.ezmeld')) return;
  var von=''; try{ von=localStorage.getItem(LS_VON)||''; }catch(e){}
  var d=document.createElement('div');
  d.className='ezmeld';
  d.innerHTML='<label class="ezl">'+h(t('melden_titel'))+'</label>'
   +'<input id="ezVon" type="text" placeholder="'+h(t('name'))+'" value="'+h(von)+'">'
   +'<textarea id="ezBem" placeholder="'+h(t('bem'))+'"></textarea>'
   +'<div class="ezfoot" style="margin-top:0">'
   +'<button class="warn" id="ezSend">'+h(t('senden'))+'</button>'
   +'<button id="ezAbb">'+h(t('abbrechen'))+'</button></div>';
  ziel.appendChild(d);
  d.querySelector('#ezAbb').onclick=function(){ d.remove(); };
  d.querySelector('#ezSend').onclick=function(){
    var v=d.querySelector('#ezVon').value.trim();
    if(!v){ alert(t('name_fehlt')); return; }
    try{ localStorage.setItem(LS_VON,v); }catch(e){}
    var eintrag={ von:v, bem:d.querySelector('#ezBem').value.trim(),
                  ts:Date.now(), datum:heute(), sprache:L };
    for(var k in (LETZTES||{})) eintrag[k]=LETZTES[k];
    senden(eintrag).then(function(ok){
      d.innerHTML='<div class="ezhelp" style="font-size:14px;font-weight:700">'
        +h(ok?t('gesendet'):t('gespeichert'))+'</div>';
    });
  };
  d.querySelector('#ezVon').focus();
}
function heute(){
  var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function senden(e){
  return fetch(DB+'/'+PFAD+'.json',{method:'POST',body:JSON.stringify(e)})
    .then(function(r){ if(!r.ok) throw 0; return true; })
    .catch(function(){ queue(e); return false; });
}
function queue(e){
  try{ var a=JSON.parse(localStorage.getItem(LS_Q)||'[]'); a.push(e);
       localStorage.setItem(LS_Q, JSON.stringify(a.slice(-100))); }catch(x){}
}
function nachsenden(){
  var a=[]; try{ a=JSON.parse(localStorage.getItem(LS_Q)||'[]'); }catch(x){ return; }
  if(!a.length || navigator.onLine===false) return;
  var rest=[];
  Promise.all(a.map(function(e){
    return fetch(DB+'/'+PFAD+'.json',{method:'POST',body:JSON.stringify(e)})
      .then(function(r){ if(!r.ok) rest.push(e); })
      .catch(function(){ rest.push(e); });
  })).then(function(){
    try{ localStorage.setItem(LS_Q, JSON.stringify(rest)); }catch(x){}
  });
}
window.addEventListener('online', nachsenden);

/* ─────────────────────── Einstieg ─────────────────────── */
window.NalpEntsorgung = {
  start:function(div){
    ZIEL=div; stilSetzen(); nachsenden();
    div.className='ez';
    div.innerHTML='<div class="ezhelp">'+h(t('laden'))+'</div>';
    regelnLaden().then(function(r){
      if(!r){ div.innerHTML='<div class="ezwarn">⚠️ uploads/entsorgung_regeln.json fehlt.</div>'; return; }
      malen();
    });
  },
  sprache:function(l){ if(T[l]) L=l; if(ZIEL&&REG) malen(); },
  /* für Tests / andere Seiten */
  pruefePassstueck:pruefePassstueck,
  etikettLesen:etikettLesen,
  regeln:function(){ return REG; },
  _laden:function(){ return regelnLaden().then(psDatenLaden); }
};
})();
