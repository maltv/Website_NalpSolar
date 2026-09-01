/* nalp-lager.js — laufende Normteil-Inventur auf dem IP Tal 1
 *
 * Wunsch Mariusz / Auftrag Victor 20.08.2026: den Bestand im Tal laufend führen
 * statt zweimal im Jahr zählen. Erfasst werden vier Teile:
 *   Knieträger S-1 · Knieträger S-4 · Quertraverse · Normstütze Berg
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
 * Die Normstütze Tal wurde am 01.09.2026 herausgenommen (Auftrag Victor): sie wird
 * nicht mehr verbaut und ist komplett nach Sursee zurück. In der Skizze bleiben die
 * Talstützen S1/S4 grau stehen – ohne sie ist die Konstruktion nicht zu erkennen.
 *
 * Ganz oben im Blatt «Bestand» steht die Uebersicht «Wie viele Tische kannst du
 * noch stellen?» (Auftrag Victor 27.08.2026): je Typ und Serie das Minimum ueber
 * die vier Teile eines Satzes (1 KT S-1 + 1 KT S-4 + 2 Normstuetzen Berg +
 * 1 Quertraverse). Das knappste Teil bestimmt die Zahl; bauteilgleiche Artikel
 * ohne Serie (z.B. Quertraverse B) zaehlen in der Gesamtsumme nur einmal.
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
var CHR_TEIL='', CHR_MAX=60;          // Chronik: Filter und wie viele Zeilen
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
 {id:'nsb', jeTisch:2, wann:'vormontage', de:'Normstütze Berg', en:'Standard post mountain', pl:'Podpora górska'},
 {id:'qt',  jeTisch:1, wann:'berg', de:'Quertraverse', en:'Cross beam', pl:'Trawersa poprzeczna'}
];
var FARBE={A:'#1565c0', B:'#D72622', C:'#8b929b', D:'#1e9e5a', E:'#e0a800'};

/* ─────────────── Skizze: wo sitzt das Teil? ───────────────
   Primaerkonstruktion von schraeg vorne. Die Punkte sind aus dem Tekla-IFC
   gerechnet (MAAG via ILF, Typ B Serie 2025,
   Stahlbau_Modelle\NalpSolar_51_PL_0351_A1_MT-3D-Ges-10er-B_250612.ifc):
   Achsen-Endpunkte je Bauteil, Kavaliersprojektion y*0.42 zur Seite und
   y*0.30 nach unten, Massstab 0.0185. Kein Massbild - aber lagerichtig.

   Die fruehere Handskizze war an drei Stellen grob falsch (beanstandet von
   Victor 01.09.2026, als Falle schon in CLAUDE.md vermerkt):
     - Quertraverse lag zwischen den BERGstuetzen; sie liegt vorne auf den
       Talstuetzen (IFC: y=190 wie die Talstuetzen, z=3461),
     - Bergstuetzen standen senkrecht; sie sind geneigt (Fuss y=3139/z=1081
       bergwaerts unten, Kopf y=1522/z=3883 talwaerts oben),
     - Knietraeger waren kurze Schraegen; sie sind die steilen Haupttraeger
       ueber die ganze Modulhoehe (3181 mm, von z=3098 auf z=6049).
   Wer die Zahlen neu braucht: scratchpad-Skripte achsen.py / skizze_punkte.py,
   Vorgehen in Memory project_normteile_inventur_tal. */
function skizze(teil, gross){
  var b=gross?190:112, hh=gross?125:74;
  var S1=[[47.9,113],[48.1,53.7]], S4=[[185,113],[184.9,53.7]];        // Tal, senkrecht
  var S2=[[25,109.4],[37.3,48.5]], S3=[[162.1,109.4],[174.9,48.5]];    // Berg, geneigt
  var QT=[[50.1,48.9],[182.8,48.9]];                                   // vorne oben
  var K1=[[49.9,55],[39.5,7]], K4=[[184.9,55],[176.8,7]];              // steile Traeger
  /* Strebe B/1006: haengt den Bergstuetzenkopf an den Knietraeger. Kein Lagerteil,
     wird nie hervorgehoben - ohne sie enden die Bergstuetzen im Bild in der Luft. */
  var T1=[[37.2,49.3],[41.9,27.7]], T4=[[174.8,49.3],[179,27.7]];
  var g='#c3c8ce', r='#D72622';
  function f(id){ return teil===id?r:g; }
  function w(id){ return teil===id?4.2:2; }
  function li(p,q,farbe,dick){ return '<line x1="'+p[0]+'" y1="'+p[1]+'" x2="'+q[0]
    +'" y2="'+q[1]+'" stroke="'+farbe+'" stroke-width="'+dick+'" stroke-linecap="round"/>'; }
  function be(x,y,tx){ return '<text x="'+x+'" y="'+y+'" font-size="9" font-weight="700"'
    +' fill="#63676d">'+tx+'</text>'; }
  var svg='<svg viewBox="0 0 210 120" width="'+b+'" height="'+hh+'" aria-hidden="true">'
   /* Standflaeche durch die vier Fusspunkte - zeigt, was vorne und hinten ist.
      Die Bergstuetzen stehen 1081 mm hoeher am Hang (IFC). */
   +'<polygon points="47.9,113 185,113 162.1,109.4 25,109.4" fill="none"'
   +' stroke="#dfe3e8" stroke-width="1.5" stroke-dasharray="3 3"/>'
   +li(S2[0],S2[1],f('nsb'),w('nsb'))+li(S3[0],S3[1],f('nsb'),w('nsb'))
   +li(T1[0],T1[1],g,1.6)+li(T4[0],T4[1],g,1.6)
   /* Modulflaeche = die Ebene ueber den beiden Knietraegern */
   +'<polygon points="'+K1[0]+' '+K1[1]+' '+K4[1]+' '+K4[0]+'" fill="#eef1f5"'
   +' stroke="#c3c8ce" stroke-width="1.2"/>'
   +li(K1[0],K1[1],f('kt1'),w('kt1'))+li(K4[0],K4[1],f('kt4'),w('kt4'))
   +li(S1[0],S1[1],g,2)+li(S4[0],S4[1],g,2)                 // Tal: nur noch Kontext
   +li(QT[0],QT[1],f('qt'),w('qt'))
   +be(41,119.5,'S1')+be(178,119.5,'S4')+be(17,116,'S2')+be(154,116,'S3')
   +'</svg>';
  return svg;
}

/* ─────────────── Texte ─────────────── */
var T={
 de:{ titel:'📦 Lager Tal', bestand:'Bestand', erfassen:'Erfassen',
  frage_art:'Was machst du?',
  korr_titel:'Bestand ändern', korr_neu:'Neuer Bestand', korr_grund:'Warum? (optional)',
  korr_ok:'Bestand gesetzt: {n}', korr_abbr:'Abbrechen', korr_hilfe:'Zahl eintragen und speichern – der alte Wert bleibt im Protokoll stehen.',
  chronik:'Chronik', chr_leer:'Noch keine Bewegung.', chr_mehr:'Ältere zeigen', chr_alle:'Alles',
  chr_vm:'Tisch {n} vormontiert', chr_neu:'Bestand neu gesetzt',
  chr_heute:'heute', chr_gestern:'gestern',
  chr_hilfe:'Alles, was den Bestand verändert hat – das Neuste zuerst. Was VOR einer Zählung liegt, steckt in dieser Zählung schon drin.',
  chr_vorher:'in der Zählung schon drin',
  gez_am:'gezählt {d}', wt:['So','Mo','Di','Mi','Do','Fr','Sa'],
  prot_titel:'Protokoll', prot_leer:'Noch keine Buchung.', prot_auto:'Vormontage (automatisch)',
  prot_zaehlung:'gezählt', prot_zugang:'geliefert', prot_abgang:'weggegangen', prot_korrektur:'geändert',
  reset_titel:'Bestand ist zurückgesetzt', reset_text:'{n} Positionen sind noch nicht gezählt. Zählen und eintragen – erst dann rechnet das Lager mit.',
  antippen:'antippen zum Ändern',
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
  ue_titel:'Tische kannst du noch stellen', ue_titel1:'Tisch kannst du noch stellen', ue_mit:'mit dem, was im Tal am Lager liegt',
  ue_offen_n:'Bei {n} Typen fehlt eine Zählung – die sind hier nicht mitgerechnet.',
  ue_offen_1:'Bei 1 Typ fehlt eine Zählung – der ist hier nicht mitgerechnet.',
  ue_zuerst:'{t} geht zuerst aus', ue_nichtgez:'nicht gezählt: {t}',
  ue_von_offen:'noch {n} zu stellen 2026', ue_reicht_alle:'reicht für alle {n} von 2026',
  ue_gesamt:'2026 sind noch {n} Tische zu stellen',
  ue_kein_bedarf:'kein Bedarf mehr 2026', ue_leer:'Noch nichts gezählt – zuerst zählen.',
  ue_hilfe:'Je Tisch 1 × S-1, 1 × S-4, 2 × Normstütze Berg, 1 × Quertraverse. Es zählt das knappste Teil. Bauteilgleiche Traversen (2025 = 2026) sind nur einmal gerechnet.',
  ue_det:'Was ein Tisch braucht', ue_det_je:'{n} × je Tisch', ue_zu:'Schliessen',
  ue_pool:'ein Stapel für 2025 + 2026',
  mit_titel:'Was geht mit hoch?', mit_hilfe:'Nur was hier steht, geht vom Lager ab. Quertraversen immer eintragen.',
  mit_zeile:'+ Teil hinzufügen', mit_keine:'nichts ausser der Konstruktion',
  anzahl:'Anzahl', entfernen:'entfernen', warnung_wenig:'Nur noch {n} {t} am Lager.',
  push_an:'🔔 Warnung aufs Handy', push_aus:'🔔 Warnung ist an', push_geht_nicht:'Dein Gerät kann keine Meldungen empfangen.',
  push_ok:'Meldung eingeschaltet.', push_nein:'Ohne Erlaubnis geht keine Meldung.' },
 en:{ titel:'📦 Valley store', bestand:'Stock', erfassen:'Record',
  frage_art:'What are you doing?',
  korr_titel:'Change stock', korr_neu:'New stock', korr_grund:'Why? (optional)',
  korr_ok:'Stock set to {n}', korr_abbr:'Cancel', korr_hilfe:'Enter the number and save – the old value stays in the log.',
  chronik:'History', chr_leer:'No movement yet.', chr_mehr:'Show older', chr_alle:'All',
  chr_vm:'Table {n} pre-assembled', chr_neu:'stock set anew',
  chr_heute:'today', chr_gestern:'yesterday',
  chr_hilfe:'Everything that changed the stock – newest first. Anything BEFORE a count is already included in that count.',
  chr_vorher:'already included in that count',
  gez_am:'counted {d}', wt:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
  prot_titel:'Log', prot_leer:'No entry yet.', prot_auto:'Pre-assembly (automatic)',
  prot_zaehlung:'counted', prot_zugang:'delivered', prot_abgang:'taken away', prot_korrektur:'changed',
  reset_titel:'Stock has been reset', reset_text:'{n} positions have not been counted yet. Count them and enter the number – only then the store can calculate.',
  antippen:'tap to change',
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
  ue_titel:'tables can still be built', ue_titel1:'table can still be built', ue_mit:'with what is in the valley store',
  ue_offen_n:'{n} types are not fully counted – they are not included here.',
  ue_offen_1:'1 type is not fully counted – it is not included here.',
  ue_zuerst:'{t} runs out first', ue_nichtgez:'not counted: {t}',
  ue_von_offen:'{n} still to build in 2026', ue_reicht_alle:'covers all {n} of 2026',
  ue_gesamt:'{n} tables still to build in 2026',
  ue_kein_bedarf:'no demand left in 2026', ue_leer:'Nothing counted yet – count first.',
  ue_hilfe:'Per table 1 × S-1, 1 × S-4, 2 × standard post mountain, 1 × cross beam. The scarcest part counts. Identical cross beams (2025 = 2026) are counted once.',
  ue_det:'What one table needs', ue_det_je:'{n} × per table', ue_zu:'Close',
  ue_pool:'one stack for 2025 + 2026',
  mit_titel:'What goes up with it?', mit_hilfe:'Only what is listed here leaves the store. Always enter cross beams.',
  mit_zeile:'+ add part', mit_keine:'nothing but the structure',
  anzahl:'Quantity', entfernen:'remove', warnung_wenig:'Only {n} {t} left in the store.',
  push_an:'🔔 Alert on my phone', push_aus:'🔔 Alert is on', push_geht_nicht:'This device cannot receive alerts.',
  push_ok:'Alert switched on.', push_nein:'Without permission there is no alert.' },
 pl:{ titel:'📦 Magazyn w dolinie', bestand:'Stan', erfassen:'Zapisz',
  frage_art:'Co robisz?',
  korr_titel:'Zmień stan', korr_neu:'Nowy stan', korr_grund:'Dlaczego? (opcjonalnie)',
  korr_ok:'Stan ustawiony: {n}', korr_abbr:'Anuluj', korr_hilfe:'Wpisz liczbę i zapisz – stara wartość zostaje w dzienniku.',
  chronik:'Kronika', chr_leer:'Brak ruchów.', chr_mehr:'Pokaż starsze', chr_alle:'Wszystko',
  chr_vm:'Stół {n} zmontowany wstępnie', chr_neu:'stan ustawiony na nowo',
  chr_heute:'dziś', chr_gestern:'wczoraj',
  chr_hilfe:'Wszystko, co zmieniło stan – od najnowszych. To, co jest PRZED liczeniem, jest już w tym liczeniu.',
  chr_vorher:'już w tym liczeniu',
  gez_am:'policzono {d}', wt:['Nd','Pn','Wt','Śr','Cz','Pt','So'],
  prot_titel:'Dziennik', prot_leer:'Brak wpisów.', prot_auto:'Montaż wstępny (automatycznie)',
  prot_zaehlung:'policzono', prot_zugang:'dostawa', prot_abgang:'wydano', prot_korrektur:'zmieniono',
  reset_titel:'Stan został wyzerowany', reset_text:'{n} pozycji nie zostało jeszcze policzonych. Policz i wpisz – dopiero wtedy magazyn liczy.',
  antippen:'dotknij, aby zmienić',
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
  ue_titel:'stołów można jeszcze postawić', ue_titel1:'stół można jeszcze postawić', ue_mit:'z tego, co leży w magazynie w dolinie',
  ue_offen_n:'{n} typów nie jest w pełni policzonych – nie ma ich w tej liczbie.',
  ue_offen_1:'1 typ nie jest w pełni policzony – nie ma go w tej liczbie.',
  ue_zuerst:'{t} skończy się pierwszy', ue_nichtgez:'nie policzono: {t}',
  ue_von_offen:'jeszcze {n} do postawienia w 2026',
  ue_reicht_alle:'starczy na wszystkie {n} z 2026',
  ue_gesamt:'w 2026 jeszcze {n} stołów do postawienia',
  ue_kein_bedarf:'brak potrzeb w 2026', ue_leer:'Nic jeszcze nie policzono – najpierw policz.',
  ue_hilfe:'Na stół 1 × S-1, 1 × S-4, 2 × podpora górska, 1 × trawersa. Liczy się najmniejszy stan. Identyczne trawersy (2025 = 2026) liczone są raz.',
  ue_det:'Czego potrzeba na stół', ue_det_je:'{n} × na stół', ue_zu:'Zamknij',
  ue_pool:'wspólny stos 2025 + 2026',
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
+'.lg .lgw.teil button{display:flex;align-items:center;gap:9px;flex:1 1 100%;text-align:left;}'
+'.lg .lgw.teil button svg{flex:none;}'
+'.lg .lgw.teil button span{font-size:15px;font-weight:800;}'
+'.lg .lgskizze{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e3e5e8;'
 +'border-radius:12px;padding:10px 12px;margin-top:12px;}'
+'.lg .lgskizze b{display:block;font-size:15px;font-weight:800;}'
+'.lg .lgskizze span{display:block;font-size:13px;color:#63676d;margin-top:2px;}'
+'.lg .lgz{cursor:pointer;}'
+'.lg .lgreset{background:#1565c0;color:#fff;border-radius:12px;padding:13px 15px;margin-bottom:12px;'
 +'font-size:14.5px;line-height:1.4;}'
+'.lg .lgreset b{display:block;font-size:16px;font-weight:900;margin-bottom:3px;}'
+'.lg .lgprot{margin-top:12px;border-top:1px solid #e3e5e8;padding-top:10px;}'
+'.lg .lgprot div{font-size:13px;color:#3d444c;padding:4px 0;border-bottom:1px solid #f0f1f3;}'
+'.lg .lgprot div b{font-weight:800;}'
+'.lg .lgprot .auto{color:#63676d;}'
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
+'.lg .lgue{background:#17293b;color:#fff;border-radius:14px;padding:14px 14px 12px;margin-bottom:12px;}'
+'.lg .lgue .kopf{display:flex;align-items:center;gap:12px;}'
+'.lg .lgue .kopf .gr{font-size:42px;font-weight:900;line-height:1;letter-spacing:-1px;}'
+'.lg .lgue .kopf .tx{flex:1;min-width:0;font-size:13px;line-height:1.3;color:#c7d2de;}'
+'.lg .lgue .kopf .tx b{display:block;font-size:15px;font-weight:800;color:#fff;margin-bottom:2px;}'
+'.lg .lgue .kopf .tx .of{display:block;margin-top:4px;font-weight:800;color:#fff;}'
+'.lg .lgue .hinw{background:rgba(255,255,255,.10);border-radius:9px;padding:8px 10px;margin-top:10px;'
 +'font-size:12.5px;font-weight:700;color:#ffd98a;line-height:1.35;}'
+'.lg .lgueg{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px;}'
+'.lg .lgk{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);border-radius:11px;'
 +'padding:9px 10px;text-align:left;color:#fff;font:inherit;cursor:pointer;display:block;width:100%;}'
+'.lg .lgk .kk{display:flex;align-items:center;gap:6px;}'
+'.lg .lgk .kk b{font-size:13.5px;font-weight:800;}'
+'.lg .lgk .kk .pkt{width:12px;height:12px;border-radius:50%;flex:none;position:relative;}'
+'.lg .lgk em{display:block;font-style:normal;font-size:30px;font-weight:900;line-height:1.05;margin:2px 0 1px;}'
+'.lg .lgk small{display:block;font-size:11.5px;line-height:1.3;color:#c7d2de;}'
+'.lg .lgk.rot em{color:#ff7a70;} .lg .lgk.rot{border-color:#ff7a70;}'
+'.lg .lgk.gelb em{color:#ffcc5c;}'
+'.lg .lgk.gruen em{color:#5fd68f;}'
+'.lg .lgk.grau em{color:#9aa6b4;}'
+'.lg .lgueh{font-size:11.5px;color:#93a3b5;line-height:1.35;margin-top:10px;}'
+'.lg .lgsatz .lgz{cursor:default;}'
+'.lg .lgchf{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;}'
+'.lg .lgchf button{border:1.5px solid #d7dade;background:#fff;color:#1a1a1a;font:700 12.5px inherit;'
 +'padding:7px 11px;border-radius:9px;cursor:pointer;}'
+'.lg .lgchf button.on{background:#1a1a1a;border-color:#1a1a1a;color:#fff;}'
+'.lg .lgcht{font:800 13px inherit;color:#1a1a1a;margin:15px 0 2px;padding-bottom:5px;'
 +'border-bottom:1.5px solid #e6e9ec;}'
+'.lg .lgchz{display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f2f4f6;}'
+'.lg .lgchz .ik{flex:0 0 20px;text-align:center;font-size:13.5px;line-height:1.35;}'
+'.lg .lgchz .tx{flex:1;min-width:0;font-size:13px;line-height:1.35;}'
+'.lg .lgchz .tx b{display:block;font-weight:800;}'
+'.lg .lgchz .tx small{display:block;color:#63676d;font-size:11.5px;margin-top:1px;}'
+'.lg .lgchz .mg{flex:0 0 auto;font:800 13.5px inherit;white-space:nowrap;padding-top:1px;}'
+'.lg .lgchz .mg.ab{color:#D72622;}'
+'.lg .lgchz .mg.zu{color:#1e9e5a;}'
+'.lg .lgchz .mg.ze{color:#1a1a1a;}'
+'.lg .lgchmehr{width:100%;margin-top:14px;border:1.5px solid #d7dade;background:#fff;'
 +'border-radius:10px;padding:12px;font:700 13px inherit;cursor:pointer;}'
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

/* Artikel = eine Zeile im Lager: Teil + Typ + Serie, alle aus material.json
   (dort steht auch der Bedarf). */
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
  var erg={ artikel:a, basis:null, basisText:'', basisDatum:'', seit:0, zugang:0, abgang:0,
            auto:0, bestand:null };
  var z=null;
  INV.forEach(function(e){
    if(e.artikel!==a.id || (e.art!=='zaehlung' && e.art!=='korrektur')) return;
    if(!z || (+e.ts||0)>(+z.ts||0)) z=e;
  });
  if(z){ erg.basis=+z.anzahl||0; erg.seit=+z.ts||0; erg.basisDatum=z.datum||dIso(z.ts);
         erg.basisText=(z.datum||'')+(z.von?' · '+z.von:''); }
  else return erg;      // Bestand am 20.08.2026 zurueckgesetzt (Entscheid Victor):
                        // Basis ist einzig eine Zaehlung im Feld, nicht mehr die
                        // Inventur aus material.json. Bis dahin: «noch nie gezählt».

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
    if(!a.bedarf) return;
    var e=bestand(a);
    if(e.bestand==null) return;
    var r=reicht(a,e.bestand);
    if(r!==null && r<ENG_TISCHE) li.push({ artikel:a, bestand:e.bestand, reicht:r, bedarf:a.bedarf });
  });
  li.sort(function(x,y){ return x.reicht-y.reicht; });
  return li;
}


/* ─────────────── Wie viele Tische lassen sich noch stellen? ───────────────
   Auftrag Victor 27.08.2026: nicht nur der Bestand je Teil, sondern die Zahl,
   die auf der Baustelle zaehlt – wie viele komplette Saetze liegen noch im Tal.
   Ein Satz = 1 Knietraeger S-1 + 1 S-4 + 2 Normstuetzen Berg + 1 Quertraverse
   im Typ und in der Serie des Tischs (jeTisch in TEILE, ILF-Stueckliste).
   Das knappste Teil bestimmt die Zahl; fehlt zu einem Teil die Zaehlung, wird
   nichts geschaetzt – das Fach bleibt offen. */
var SATZ_TEILE=['kt1','kt4','nsb','qt'];

function saetze(){
  var li=artikel(), serien={}, fach={}, reihe=[];
  /* Welche Serien gibt es je Typ? Nur serienreine Artikel geben das vor -
     bauteilgleiche (Serie '') gehoeren in beide. */
  li.forEach(function(a){ if(a.serie==='') return;
    (serien[a.typ]=serien[a.typ]||{})[a.serie]=1; });
  function holen(typ,serie){
    var k=typ+'|'+serie;
    if(!fach[k]){ fach[k]={key:k, typ:typ, serie:serie, teile:{}, tische:null,
                           eng:null, offen:null, fehlt:[]}; reihe.push(fach[k]); }
    return fach[k];
  }
  li.forEach(function(a){
    var def=teilDef(a.teil);
    if(!def||!def.jeTisch) return;
    var ser=(a.serie!=='')?[a.serie]:Object.keys(serien[a.typ]||{});
    if(!ser.length) ser=[''];
    ser.forEach(function(se){ holen(a.typ,se).teile[a.teil]=a; });
  });
  reihe.forEach(function(f){
    SATZ_TEILE.forEach(function(tid){
      var def=teilDef(tid), a=f.teile[tid];
      if(!a){ f.fehlt.push(tid); f.teile[tid]=null; return; }
      var e=bestand(a), n=(e.bestand==null?null:Math.floor(e.bestand/def.jeTisch));
      f.teile[tid]={artikel:a, bestand:e.bestand, tische:n};
      if(n==null){ f.fehlt.push(tid); return; }
      if(f.tische==null || n<f.tische){ f.tische=n; f.eng=tid; }
    });
    if(f.fehlt.length){ f.tische=null; f.eng=null; }      // nichts schaetzen
    /* Wie viele Tische stehen 2026 ueberhaupt noch an? Aus material.json, aber
       nur aus einem serienreinen Teil - beim gepoolten steht der Bedarf beider
       Serien zusammen und wuerde die Zahl verdoppeln. */
    SATZ_TEILE.forEach(function(tid){
      if(f.offen!=null) return;
      var x=f.teile[tid], a=x&&x.artikel;
      if(!a||a.serie===''||a.bedarf==null) return;
      f.offen=Math.round(a.bedarf/teilDef(tid).jeTisch);
    });
  });
  reihe.sort(function(x,y){
    if((x.tische==null)!==(y.tische==null)) return x.tische==null?1:-1;
    if(x.tische!=null&&x.tische!==y.tische) return x.tische-y.tische;
    return (x.typ+x.serie)<(y.typ+y.serie)?-1:1;
  });
  return reihe;
}

/* Summe ueber alle Faecher. Ein bauteilgleicher Artikel ohne Serie (Quertraverse B)
   liegt fuer beide Serien im selben Stapel - er darf nur einmal gezaehlt werden. */
function satzGesamt(reihe){
  var summe=0, offen=0, pool={};
  reihe.forEach(function(f){
    if(f.tische==null){ offen++; return; }
    summe+=f.tische;
    SATZ_TEILE.forEach(function(tid){
      var x=f.teile[tid];
      if(!x||!x.artikel||x.artikel.serie!==''||x.tische==null) return;
      var p=pool[x.artikel.id]||(pool[x.artikel.id]={kap:x.tische, braucht:0});
      p.braucht+=f.tische;
    });
  });
  for(var id in pool) if(pool[id].braucht>pool[id].kap) summe-=(pool[id].braucht-pool[id].kap);
  return { tische:Math.max(0,summe), offen:offen };
}

function satzAmpel(f){
  if(f.tische==null) return 'grau';
  if(!f.offen) return 'gruen';                    // fuer diesen Typ steht nichts mehr an
  if(f.tische<ENG_TISCHE) return 'rot';
  return f.tische<f.offen?'gelb':'gruen';
}
function teilName(tid){ var d=teilDef(tid); return d?tt(d):tid; }

function uebersicht(){
  var reihe=saetze(), g=satzGesamt(reihe), gez=reihe.length-g.offen;
  /* Wie viele Tische stehen 2026 ueberhaupt noch an? Summe ueber die Faecher
     (Bedarf aus material.json), damit die Zahl oben einen Bezug hat. */
  var offenGesamt=0; reihe.forEach(function(f){ if(f.offen) offenGesamt+=f.offen; });
  var s='<div class="lgue"><div class="kopf"><span class="gr">'
   +(gez?g.tische:'–')+'</span><span class="tx"><b>'
   +h(t(gez&&g.tische===1?'ue_titel1':'ue_titel'))+'</b>'+h(t('ue_mit'))
   +(offenGesamt?'<span class="of">'+h(t('ue_gesamt',{n:offenGesamt}))+'</span>':'')
   +'</span></div>';
  if(!gez) s+='<div class="hinw">'+h(t('ue_leer'))+'</div>';
  else if(g.offen) s+='<div class="hinw">'+h(t(g.offen===1?'ue_offen_1':'ue_offen_n',{n:g.offen}))+'</div>';
  s+='<div class="lgueg">';
  reihe.forEach(function(f){
    var z1, z2;
    if(f.tische==null) z1=t('ue_nichtgez',{t:f.fehlt.map(teilName).join(', ')});
    else z1=f.eng?t('ue_zuerst',{t:teilName(f.eng)}):'';
    if(!f.offen) z2=t('ue_kein_bedarf');
    else if(f.tische!=null&&f.tische>=f.offen) z2=t('ue_reicht_alle',{n:f.offen});
    else z2=t('ue_von_offen',{n:f.offen});
    s+='<button class="lgk '+satzAmpel(f)+'" data-k="'+h(f.key)+'">'
     +'<span class="kk"><span class="pkt'+(f.serie==='2026'?' n26':'')+'" style="background:'
     +(FARBE[f.typ]||'#999')+'"></span><b>'+h(f.typ+(f.serie?' · '+f.serie:''))+'</b></span>'
     +'<em>'+(f.tische==null?'?':f.tische)+'</em>'
     +'<small>'+h(z1)+(z1&&z2?'<br>':'')+h(z2)+'</small></button>';
  });
  s+='</div><div class="lgueh">'+h(t('ue_hilfe'))+'</div></div>';
  return s;
}

/* Kachel antippen: woran haengt die Zahl? Alle vier Teile mit ihrem Bestand. */
function satzDetail(key){
  var f=null; saetze().forEach(function(x){ if(x.key===key) f=x; });
  if(!f) return;
  var alt=document.getElementById('lgSatz'); if(alt) alt.remove();
  var d=document.createElement('div');
  d.id='lgSatz'; d.className='lg lgsatz';
  d.style.cssText='position:fixed;inset:0;z-index:80;background:rgba(10,20,32,.55);'
   +'display:flex;align-items:flex-end;justify-content:center;';
  var kopfZahl=(f.tische==null)?'?':f.tische;
  var kopfText=(f.tische==null)?t('ungezaehlt')
    :t(f.tische===1?'reicht1':(f.tische===0?'reicht0':'reicht'),{n:f.tische});
  var innen='<div class="lgskizze" style="margin-top:0">'
   +'<span style="width:26px;height:26px;border-radius:50%;flex:none;background:'
   +(FARBE[f.typ]||'#999')+'"></span>'
   +'<div><b>'+h(f.typ+(f.serie?' · '+f.serie:''))+' – '+h(kopfZahl)+'</b>'
   +'<span>'+h(kopfText)+'</span></div></div>'
   +'<label class="lgl">'+h(t('ue_det'))+'</label>';
  SATZ_TEILE.forEach(function(tid){
    var x=f.teile[tid], def=teilDef(tid);
    var unter=t('ue_det_je',{n:def.jeTisch}), zahl='–';
    if(x&&x.bestand!=null){ zahl=x.bestand;
      unter+=' · '+t(x.tische===1?'reicht1':(x.tische===0?'reicht0':'reicht'),{n:x.tische}); }
    else unter+=' · '+t('ungezaehlt');
    if(x&&x.artikel&&x.artikel.serie==='') unter+=' · '+t('ue_pool');   // gepoolter Stapel
    innen+='<div class="lgz'+(tid===f.eng?' rot':'')+'"><span class="lgt"><b>'+h(tt(def))+'</b>'
     +'<span>'+h(unter)+'</span></span><span class="lgn">'+zahl
     +'<small>'+h(t('stueck'))+'</small></span></div>';
  });
  innen+='<button class="lgbtn grau" id="lgSatzZu">'+h(t('ue_zu'))+'</button>';
  d.innerHTML='<div style="background:#eef1f5;width:100%;max-width:620px;border-radius:16px 16px 0 0;'
   +'padding:16px 14px calc(18px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto">'
   +innen+'</div>';
  document.body.appendChild(d);
  d.onclick=function(ev){ if(ev.target===d) d.remove(); };
  d.querySelector('#lgSatzZu').onclick=function(){ d.remove(); };
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
   +'<button id="lgC" class="'+(ANSICHT==='chronik'?'on':'')+'">'+h(t('chronik'))+'</button>'
   +'</div><div id="lgBody"></div>';
  ZIEL.querySelector('#lgB').onclick=function(){ ANSICHT='bestand'; malen(); };
  ZIEL.querySelector('#lgE').onclick=function(){ ANSICHT='erfassen'; malen(); };
  ZIEL.querySelector('#lgC').onclick=function(){ ANSICHT='chronik'; CHR_MAX=60; malen(); };
  if(ANSICHT==='bestand') malenBestand();
  else if(ANSICHT==='chronik') malenChronik();
  else malenErfassen();
}

function malenBestand(){
  var b=ZIEL.querySelector('#lgBody'), s='';
  s+=uebersicht();                   // ganz oben: wie viele Tische liegen noch da
  var offen=0;
  artikel().forEach(function(a){ if(bestand(a).bestand==null) offen++; });
  if(offen) s+='<div class="lgreset"><b>'+h(t('reset_titel'))+'</b>'+h(t('reset_text',{n:offen}))+'</div>';
  var eng=engpaesse();
  if(eng.length){
    s+='<div class="lgeng">'+h(t('eng_titel'))+'<br>';
    eng.slice(0,6).forEach(function(x){
      s+='<b>'+h(x.artikel.name)+'</b>: '+x.bestand+' '+h(t('stueck'))+' – '
        +h(t(x.reicht===1?'reicht1':(x.reicht===0?'reicht0':'reicht'),{n:x.reicht}))+'<br>';
    });
    s+='</div>';
  } else if(!offen) s+='<div class="lgok">'+h(t('eng_keiner'))+'</div>';

  s+='<button class="lgpush" id="lgPush">'+h(t('push_an'))+'</button>';

  TEILE.forEach(function(def){
    var li=artikel().filter(function(a){ return a.teil===def.id; });
    if(!li.length) return;
    li.sort(function(x,y){ return (x.typ+x.serie)<(y.typ+y.serie)?-1:1; });
    s+='<h3 class="lgh">'+h(tt(def))+'</h3>';
    li.forEach(function(a){
      var e=bestand(a), amp=ampel(a,e), r=reicht(a,e.bestand);
      var unter=[];
      if(e.bestand==null) unter.push(t('ungezaehlt'));
      else if(e.bestand<0) unter.push(t('negativ'));   // mehr verbraucht als gezaehlt
      else {
        if(r!==null) unter.push(t(r===1?'reicht1':(r===0?'reicht0':'reicht'),{n:r}));
        if(a.bedarf) unter.push(t('bedarf',{n:a.bedarf}));
      }
      /* Wann wurde zuletzt gezaehlt? Stand bisher nur im Erfassen-Formular
         (Rueckmeldung Victor 01.09.2026). */
      if(e.basisDatum) unter.push(t('gez_am',{d:dKurz(e.basisDatum)}));
      s+='<div class="lgz '+amp+'" data-a="'+a.id+'">'
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
  klick(b,'.lgk[data-k]',function(el){ satzDetail(el.getAttribute('data-k')); });
  klick(b,'.lgz[data-a]',function(el){ korrigieren(el.getAttribute('data-a')); });
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

  s+='<label class="lgl">'+h(t('frage_teil'))+'</label><div class="lgw teil" id="lgT">';
  TEILE.forEach(function(d){
    s+='<button data-t="'+d.id+'" class="'+(eTeil===d.id?'on':'')+'">'
      +skizze(d.id,false)+'<span>'+h(tt(d))+'</span>'
      +(tt(d,'h')?'<small>'+h(tt(d,'h'))+'</small>':'')+'</button>';
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
    /* Jahr immer zeigen, auch wenn es nur eines gibt - sonst weiss niemand,
       auf welche Serie er gerade bucht (Rueckmeldung Victor 20.08.2026). */
    var ser=serienFuer(eTeil,eTyp);
    if(ser.length===1 && eSerie===null) eSerie=ser[0];
    s+='<label class="lgl">'+h(t('frage_serie'))+'</label><div class="lgw" id="lgSe">';
    ser.forEach(function(se){
      s+='<button data-se="'+se+'" class="'+(eSerie===se?'on':'')+'">'
        +h(se===''?t('beide'):se)+'</button>';
    });
    s+='</div>';
  }
  if(eTeil&&eTyp&&eSerie!==null){
    var aSel=artikelId(eTeil,eTyp,eSerie), eSel=aSel?bestand(aSel):null;
    s+='<div class="lgskizze">'+skizze(eTeil,true)+'<div><b>'+h(tt(teilDef(eTeil)))+'</b><span>'
     +h(eTyp+' · '+(eSerie||t('beide')))+'</span></div></div>';
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

/* ─────────────── Bestand von Hand aendern ───────────────
   Zeile im Bestand antippen: neue Zahl setzen (z.B. nach dem Nachzaehlen oder
   wenn eine Buchung falsch war). Der alte Wert bleibt im Protokoll stehen -
   nichts wird ueberschrieben, es kommt eine Buchung dazu. */
function korrigieren(id){
  var a=null; artikel().forEach(function(x){ if(x.id===id) a=x; });
  if(!a) return;
  var e=bestand(a), def=teilDef(a.teil);
  var alt=document.getElementById('lgKorr'); if(alt) alt.remove();
  var d=document.createElement('div');
  d.id='lgKorr';
  d.style.cssText='position:fixed;inset:0;z-index:80;background:rgba(10,20,32,.55);'
   +'display:flex;align-items:flex-end;justify-content:center;';
  d.innerHTML='<div style="background:#eef1f5;width:100%;max-width:620px;border-radius:16px 16px 0 0;'
   +'padding:16px 14px calc(18px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto">'
   +'<div class="lgskizze" style="margin-top:0">'+skizze(a.teil,true)
   +'<div><b>'+h(tt(def))+'</b><span>'+h(a.typ+' · '+(a.serie||t('beide')))+'</span></div></div>'
   +'<label class="lgl">'+h(t('korr_neu'))+'</label>'
   +'<input class="lgin" id="kNeu" type="number" inputmode="numeric" value="'
   +(e.bestand==null?'':e.bestand)+'">'
   +'<div class="lghint">'+h(t('korr_hilfe'))+'</div>'
   +'<label class="lgl">'+h(t('korr_grund'))+'</label>'
   +'<input class="lgin" id="kGrund" type="text">'
   +'<label class="lgl">'+h(t('name'))+'</label>'
   +'<input class="lgin" id="kVon" type="text" value="'+h(vonLesen())+'">'
   +'<button class="lgbtn" id="kOk">'+h(t('speichern'))+'</button>'
   +'<button class="lgbtn grau" id="kAb" style="margin-top:8px">'+h(t('korr_abbr'))+'</button>'
   +'<div class="lgprot"><label class="lgl" style="margin-top:2px">'+h(t('prot_titel'))+'</label>'
   +protokoll(a)+'</div></div>';
  d.className='lg';
  document.body.appendChild(d);
  d.onclick=function(ev){ if(ev.target===d) d.remove(); };
  d.querySelector('#kAb').onclick=function(){ d.remove(); };
  d.querySelector('#kOk').onclick=function(){
    var n=d.querySelector('#kNeu').value, von=(d.querySelector('#kVon').value||'').trim();
    if(n===''||isNaN(+n)){ alert(t('fehlt_teil')); return; }
    if(!von){ alert(t('fehlt_name')); return; }
    try{ localStorage.setItem(LS_VON,von); }catch(x){}
    var rec={ art:'korrektur', artikel:a.id, teil:a.teil, typ:a.typ, serie:a.serie,
              anzahl:Math.round(+n), grund:(d.querySelector('#kGrund').value||'').trim(),
              vorher:(e.bestand==null?null:e.bestand),
              von:von, datum:heute(), ts:Date.now(), quelle:'korrektur' };
    INV.push(JSON.parse(JSON.stringify(rec)));
    senden(rec,null).catch(function(){ Q.add({rec:rec,foto:null}); })
      .then(function(){ d.remove(); meldung(t('korr_ok',{n:Math.round(+n)})); malen(); });
  };
}
function protokoll(a){
  var e=bestand(a), li=chronikZeilen(null,a), s='';
  /* Summe oben, damit die Rechnung nachvollziehbar bleibt: nur was NACH der
     letzten Zaehlung liegt, belastet den Bestand. Darunter die Zeitleiste. */
  if(e.auto) s+='<div class="auto">'+h(t('prot_auto'))+': −'+e.auto+' '+h(t('stueck'))+'</div>';
  if(!li.length) return s||'<div class="auto">'+h(t('prot_leer'))+'</div>';
  li.slice(0,14).forEach(function(x){
    /* Was vor der letzten Zaehlung liegt, steckt in dieser Zaehlung schon
       drin und belastet den Bestand nicht mehr - sonst wundert sich jeder,
       warum die Summe oben kleiner ist als die Zeilen darunter. */
    var vor=((x.ts||0)<e.seit)?' <span class="auto">'+h(t('chr_vorher'))+'</span>':'';
    if(x.kind==='vm'){
      s+='<div><b>−'+x.summe+' '+h(t('stueck'))+'</b> · '+h(t('prot_auto'))
        +' · '+h(dKurz(x.datum))+' · '+h(t('chr_vm',{n:x.tisch}))+vor+'</div>';
      return;
    }
    var y=x.e, wie=t('prot_'+(y.art||'zaehlung'));
    var zahl=(y.art==='zugang'?'+':(y.art==='abgang'?'−':''))+y.anzahl;
    s+='<div><b>'+h(zahl)+' '+h(t('stueck'))+'</b> · '+h(wie)+' · '+h(dKurz(x.datum))
      +(y.von?' · '+h(y.von):'')
      +(y.vorher!=null?' <span class="auto">('+y.vorher+' → '+y.anzahl+')</span>':'')
      +(y.grund?' <span class="auto">'+h(y.grund)+'</span>':'')
      +(y.tische?' <span class="auto">'+h(y.tische)+'</span>':'')+vor+'</div>';
  });
  if(li.length>14) s+='<div class="auto">… '+(li.length-14)+'</div>';
  return s;
}

/* ─────────────── Datum ─────────────── */
function dIso(ts){ var d=new Date(+ts||0);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')
        +'-'+String(d.getDate()).padStart(2,'0'); }
function dKurz(iso){ var p=String(iso||'').split('-');
  return p.length===3?(p[2]+'.'+p[1]+'.'):String(iso||''); }
function dLang(iso){
  var p=String(iso||'').split('-'); if(p.length!==3) return String(iso||'');
  var w=(T[L]&&T[L].wt)||T.de.wt, d=new Date(+p[0],+p[1]-1,+p[2]);
  var s=w[d.getDay()]+' '+p[2]+'.'+p[1]+'.'+p[0];
  if(iso===heute()) s+=' · '+t('chr_heute');
  else if(iso===dIso(Date.now()-86400000)) s+=' · '+t('chr_gestern');
  return s;
}

/* ─────────────── Chronik ───────────────
   Alle Ereignisse, die den Bestand veraendert haben, in einer Zeitleiste.
   Die Abgaenge aus der Vormontage standen bisher NIRGENDS mit Datum - im
   Protokoll je Artikel gab es nur eine Summe (Wunsch Victor 01.09.2026:
   sehen, wann zuletzt erfasst wurde und wann was weggegangen ist). */
function vormontageListe(){
  var erst={};
  FORT.forEach(function(f){
    if(f.art!=='vormontiert'||!f.tischId) return;
    var id=String(f.tischId), ts=+f.ts||0;
    if(!erst[id]||ts<erst[id].ts) erst[id]={ts:ts, datum:f.datum||dIso(ts), von:f.von||''};
  });
  return erst;
}

/* nurTeil = nur dieses Teil zeigen (Filter), nurArtikel = Protokoll einer Zeile. */
function chronikZeilen(nurTeil, nurArtikel){
  var li=[];
  INV.forEach(function(e){
    if(nurArtikel){ if(e.artikel!==nurArtikel.id) return; }
    else if(nurTeil && e.teil!==nurTeil) return;
    li.push({ts:+e.ts||0, datum:e.datum||dIso(e.ts), kind:'buch', e:e});
  });
  var vm=vormontageListe();
  for(var id in vm){
    var tp=String(TYPEN[id]||''), typ=(tp.charAt(0)||'').toUpperCase(),
        se=(tp.split('_')[1]||''), teile=[], summe=0;
    if(!typ) continue;                       // Typ unbekannt: nichts behaupten
    TEILE.forEach(function(d){
      if(d.wann!=='vormontage'||!d.jeTisch) return;
      if(nurArtikel){ if(d.id!==nurArtikel.teil||!passt(nurArtikel,tp)) return; }
      else if(nurTeil && d.id!==nurTeil) return;
      teile.push({teil:d.id, n:d.jeTisch}); summe+=d.jeTisch;
    });
    if(!teile.length) continue;
    li.push({ts:vm[id].ts, datum:vm[id].datum, kind:'vm', tisch:id, typ:typ,
             serie:se, von:vm[id].von, teile:teile, summe:summe});
  }
  li.sort(function(x,y){ return (y.ts||0)-(x.ts||0); });
  return li;
}

function chrZeile(x){
  if(x.kind==='vm'){
    var was=x.teile.map(function(p){ return '−'+p.n+' '+teilName(p.teil); }).join(' · ');
    return '<div class="lgchz"><span class="ik">🔧</span><span class="tx">'
     +'<b>'+h(t('chr_vm',{n:x.tisch}))+(x.typ?' ('+h(x.typ+(x.serie?' '+x.serie:''))+')':'')+'</b>'
     +'<small>'+h(was+(x.von?' · '+x.von:''))+'</small></span>'
     +'<span class="mg ab">−'+x.summe+'</span></div>';
  }
  var e=x.e, art=e.art||'zaehlung', mg, kl;
  var ik=(art==='zugang'?'📦':(art==='abgang'?'🚚'
        :(art==='korrektur'?'✎':'\ud83d\udccb')));
  if(art==='zugang'){ mg='+'+e.anzahl; kl='zu'; }
  else if(art==='abgang'){ mg='−'+e.anzahl; kl='ab'; }
  else { mg='= '+e.anzahl; kl='ze'; }
  var u=[t('prot_'+art)];
  if(art==='zaehlung'||art==='korrektur') u.push(t('chr_neu'));
  if(e.vorher!=null) u.push(e.vorher+' → '+e.anzahl);
  if(e.von) u.push(e.von);
  if(e.grund) u.push(e.grund);
  if(e.tische) u.push(e.tische);
  return '<div class="lgchz"><span class="ik">'+ik+'</span><span class="tx">'
   +'<b>'+h(teilName(e.teil)+' '+(e.typ||'')+(e.serie?' '+e.serie:''))+'</b>'
   +'<small>'+h(u.join(' · '))+'</small></span>'
   +'<span class="mg '+kl+'">'+h(mg)+'</span></div>';
}

function malenChronik(){
  var b=ZIEL.querySelector('#lgBody'), s='';
  /* Nur Teile anbieten, zu denen es ueberhaupt etwas zu sehen gibt. */
  var hat={}; chronikZeilen('',null).forEach(function(x){
    if(x.kind==='vm') x.teile.forEach(function(p){ hat[p.teil]=1; });
    else hat[x.e.teil]=1; });
  s+='<div class="lgchf"><button data-t="" class="'+(CHR_TEIL===''?'on':'')+'">'
    +h(t('chr_alle'))+'</button>';
  TEILE.forEach(function(d){
    if(!hat[d.id]) return;
    s+='<button data-t="'+d.id+'" class="'+(CHR_TEIL===d.id?'on':'')+'">'+h(tt(d))+'</button>';
  });
  s+='</div><div class="lgueh">'+h(t('chr_hilfe'))+'</div>';
  var li=chronikZeilen(CHR_TEIL,null), tag='';
  if(!li.length) s+='<div class="lghint">'+h(t('chr_leer'))+'</div>';
  li.slice(0,CHR_MAX).forEach(function(x){
    if(x.datum!==tag){ tag=x.datum; s+='<div class="lgcht">'+h(dLang(tag))+'</div>'; }
    s+=chrZeile(x);
  });
  if(li.length>CHR_MAX) s+='<button class="lgchmehr" id="lgMehrC">'+h(t('chr_mehr'))
    +' ('+(li.length-CHR_MAX)+')</button>';
  b.innerHTML=s;
  klick(b,'.lgchf button[data-t]',function(el){
    CHR_TEIL=el.getAttribute('data-t'); CHR_MAX=60; malenChronik(); });
  var m=b.querySelector('#lgMehrC');
  if(m) m.onclick=function(){ CHR_MAX+=60; malenChronik(); };
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
  saetze:function(){ return MAT?saetze():[]; },
  satzGesamt:function(){ return MAT?satzGesamt(saetze()):{tische:0,offen:0}; },
  bestandVon:function(id){ var a=null;
    artikel().forEach(function(x){ if(x.id===id) a=x; });
    return a?bestand(a):null; },
  artikel:artikel,
  laden:laden
};
})();
