/*
 * nalp-live.js — die Tagesdateien unter uploads/ auf dem Portal LIVE aus der BuildTrack-API (05.11.2026).
 *
 * Die Seiten lesen ihre Daten aus Dateien, die die naechtlichen Builder in tools/ schreiben. Auf
 * portal.buildtrack.ch mit einer angemeldeten Sitzung (nalpBT.sitzung(), assets/js/nalp-buildtrack.js) baut diese
 * Datei dasselbe Objekt — gleiche Form, gleiche Rundung, gleiche Reihenfolge — direkt aus der API:
 *
 *   uploads/tables/bohrstand.json        GET /api/w1/exports/drilling-point-data.csv   wie tools/build_bohrstand.py
 *   uploads/tables/bohrpunkte_koo.json   dieselbe CSV                                  (ohne den alten Cache: nur der Export)
 *   uploads/tables/baustand.json         GET /api/w1/exports/table-id.csv              wie tools/build_baustand.py
 *   uploads/tables/bereiche.json         dieselbe CSV, Spalte Bauphasen_STRABAG_260410 wie bereiche_bauen() in tools/nalpi_stand_api.py
 *   uploads/tables/modultische_all.json  /api/w1/q/tables                              wie tools/build_modultische_api.py
 *   uploads/tables/ps_tal.json           /api/w1/q/passstuecke + /tables (office:read)  wie tools/build_ps_tal.py
 *   uploads/maengel.json                 /api/w1/q/maengel                             wie tools/maengel_snapshot.py
 *
 * Was ein Builder verweigern wuerde (Spalte fehlt, zu wenig Zeilen, Fehler, 401/403) und alles ausserhalb des Portals
 * oder ohne Anmeldung (auch offline) geht wie bisher: fetch(pfad, optionen) der Seite, unveraendert.
 *
 *   nalpLive.fetch(pfad, optionen)  → Promise<Response>  (live: eine 200-Antwort mit dem gebauten JSON; sonst fetch())
 *   nalpLive.json(pfad, optionen)   → Promise<Objekt>    (= nalpLive.fetch(…).then(r => r.json()))
 *
 * Je Seitenaufruf wird jedes Objekt einmal gebaut (jeder Aufruf bekommt eine eigene Kopie).
 * Einbindung: <script src="assets/js/nalp-live.js"></script> vor dem Skript, das die Daten liest; nalp-buildtrack.js
 * wird auf dem Portal nachgeladen, falls die Seite es nicht selbst einbindet. Ausserhalb des Portals tut die Datei
 * nichts als fetch(). Die reinen Bau-Funktionen laufen auch unter Node (Vergleich mit den Python-Buildern).
 */
(function (root) {
  'use strict';

  /* ══════════ Python-Verhalten, das die Builder voraussetzen ══════════ */

  /* round(x, n) wie Python: der exakte Wert des Doubles, korrekt gerundet, bei exakt halb auf die gerade Ziffer. */
  function pyRound(x, n) {
    if (typeof x !== 'number') throw new TypeError('round: keine Zahl');
    if (!isFinite(x) || x === 0) return x;
    var neg = x < 0, a = Math.abs(x);
    if (a >= 1e21) return x;
    var voll = a.toFixed(100);                  /* exakte Dezimaldarstellung (Doubles >= 1e-7 brauchen weniger Stellen) */
    var p = voll.indexOf('.');
    var vorn = voll.slice(0, p + 1 + n), rest = voll.slice(p + 1 + n);
    var hoch;
    if (rest.charAt(0) > '5') hoch = true;
    else if (rest.charAt(0) < '5') hoch = false;
    else if (/[1-9]/.test(rest.slice(1))) hoch = true;
    else hoch = (+vorn.charAt(vorn.length - 1)) % 2 === 1;   /* genau halb: gerade Ziffer */
    var z = vorn.replace('.', '').split('');
    if (hoch) {
      var i = z.length - 1;
      while (i >= 0) { if (z[i] === '9') { z[i] = '0'; i--; } else { z[i] = String(+z[i] + 1); break; } }
      if (i < 0) z.unshift('1');
    }
    var txt = z.join('');
    txt = n > 0 ? txt.slice(0, txt.length - n) + '.' + txt.slice(txt.length - n) : txt;
    var r = Number(txt);
    return neg ? -r : r;
  }
  /* a % b wie Python (Vorzeichen des Divisors). */
  function pyMod(a, b) {
    var m = a % b;
    if (m) { if ((b < 0) !== (m < 0)) m += b; } else m = b < 0 ? -0 : 0;
    return m;
  }
  /* float(s) wie Python fuer Text (ohne Unicode-Ziffern); null statt ValueError. */
  function pyFloat(s) {
    var t = String(s).trim();
    var m = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
    if (m) return /n/i.test(m[2].charAt(0)) ? NaN : (m[1] === '-' ? -Infinity : Infinity);
    if (!/^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/.test(t)) return null;
    return Number(t.replace(/_/g, ''));
  }
  /* int(s) wie Python fuer Text; null statt ValueError. */
  function pyInt(s) {
    var t = String(s).trim();
    if (!/^[+-]?\d(_?\d)*$/.test(t)) return null;
    return parseInt(t.replace(/_/g, ''), 10);
  }
  /* str(v) wie Python fuer die Werte, die hier vorkommen. */
  function pyStr(v) {
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    return String(v);
  }
  /* «Wahr» wie Python: leere Texte, 0, null, leere Listen/Objekte sind falsch. */
  function pyWahr(v) {
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return Object.keys(v).length > 0;
    return !!v;
  }
  function istZiffern(s) { return /^[0-9]+$/.test(s); }
  function zfill(s, n) {
    var vz = '', r = s;
    if (r.charAt(0) === '+' || r.charAt(0) === '-') { vz = r.charAt(0); r = r.slice(1); }
    while (vz.length + r.length < n) r = '0' + r;
    return vz + r;
  }
  function vergleich(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  /* Objekte mit sortierten Schluesseln (json.dumps(sort_keys=True)). */
  function sortiert(o) {
    if (Array.isArray(o)) return o.map(sortiert);
    if (o && typeof o === 'object') {
      var r = {};
      Object.keys(o).sort(vergleich).forEach(function (k) { r[k] = sortiert(o[k]); });
      return r;
    }
    return o;
  }

  /* Kalendertag / Minute in Zuerich. */
  function zuerichTeile(d) {
    var f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
                                               hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var t = {};
    f.formatToParts(d).forEach(function (x) { t[x.type] = x.value; });
    return t;
  }
  function zuerichTag(d) { var t = zuerichTeile(d); return t.year + '-' + t.month + '-' + t.day; }
  function zuerichMinute(d) { var t = zuerichTeile(d); return t.year + '-' + t.month + '-' + t.day + ' ' + t.hour + ':' + t.minute; }

  /* ══════════ CSV wie Pythons csv-Modul (Dialekt excel: Komma, "…", "" = ") ══════════
     Der Export schreibt jede Zelle in Anfuehrungszeichen, ein BOM, \r\n zwischen den Zeilen (pwa/api/src/w1/exports.ts). */
  function csvZeilen(text) {
    var s = String(text || '');
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var zeilen = [], zeile = [], feld = '', zustand = 0;   /* 0 Zeilenanfang, 1 Feldanfang, 2 im Feld, 3 in "…", 4 " in "…" */
    function feldFertig() { zeile.push(feld); feld = ''; }
    function zeileFertig() { zeilen.push(zeile); zeile = []; }
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (zustand === 3) { if (c === '"') zustand = 4; else feld += c; continue; }
      if (c === '\r' || c === '\n') {
        if (zustand !== 0) { feldFertig(); zeileFertig(); }
        else zeileFertig();                         /* leere Zeile → [] (DictReader ueberspringt sie) */
        if (c === '\r' && s.charAt(i + 1) === '\n') i++;
        zustand = 0; continue;
      }
      if (zustand === 4) {
        if (c === '"') { feld += '"'; zustand = 3; }
        else if (c === ',') { feldFertig(); zustand = 1; }
        else { feld += c; zustand = 2; }
        continue;
      }
      if (zustand === 0 || zustand === 1) {
        if (c === '"') { zustand = 3; continue; }
        if (c === ',') { feldFertig(); zustand = 1; continue; }
        feld += c; zustand = 2; continue;
      }
      if (c === ',') { feldFertig(); zustand = 1; } else feld += c;     /* zustand 2 */
    }
    if (zustand !== 0) { feldFertig(); zeileFertig(); }
    return zeilen;
  }
  /* csv.DictReader: erste Zeile = Spalten, leere Zeilen fallen weg, fehlende Zellen = null. */
  function csvDict(text) {
    var z = csvZeilen(text);
    var felder = z.length ? z[0] : [];
    var rows = [];
    for (var i = 1; i < z.length; i++) {
      if (!z[i].length) continue;
      var r = Object.create(null);
      for (var k = 0; k < felder.length; k++) r[felder[k]] = k < z[i].length ? z[i][k] : null;
      rows.push(r);
    }
    return { felder: felder, rows: rows };
  }
  function g(r, k) { var v = r[k]; return v === undefined ? null : v; }
  function txt(v) { return (v || '').trim(); }        /* (r.get(k) or '').strip() */

  /* ══════════ build_bohrstand.py (Vollexport DRILLING_POINT_DATA) ══════════ */
  var NAMEN = ['Geplant', 'Abgesteckt', 'Gebohrt', 'Pfähle fixiert', 'Injiziert'];
  function zahl(s) {
    var t = (s || '').trim().replace(/,/g, '');
    if (!t) return null;
    return pyFloat(t);
  }
  function bauBohrstand(csvText, stand) {
    var d = csvDict(csvText);
    if (d.felder.join(',').indexOf('FOUNDATION_ID') < 0) throw new Error('bohrstand: kein Vollexport');
    var koo = {}, status = {};
    d.rows.forEach(function (r) {
      var fid = txt(g(r, 'FOUNDATION_ID'));
      var m = /^(\S+?)_S([1-4])$/.exec(fid);
      if (!m) return;
      var key = m[1] + '_S' + m[2];
      var E = zahl(g(r, 'IST_O')) || zahl(g(r, 'SOLL_O'));
      var N = zahl(g(r, 'IST_N')) || zahl(g(r, 'SOLL_N'));
      var H = zahl(g(r, 'IST_H')) || zahl(g(r, 'SOLL_H'));
      if (E === null || N === null) return;
      koo[key] = [pyRound(E, 2), pyRound(N, 2), H !== null ? pyRound(H, 2) : null];
      function da(k) { return !!txt(g(r, k)); }
      var st = da('INJ_DATE') ? 4 : da('SURVEY_DATE') ? 3 : da('DRILL_DATE') ? 2 : da('STAK_DATE') ? 1 : 0;
      var nb = pyInt(txt(g(r, 'REDRILLS') || '0') || '0');
      status[key] = [st, nb === null ? 0 : nb];
    });
    var keys = Object.keys(status);
    if (!keys.length) throw new Error('bohrstand: keine Statusdaten');
    function sk(k) { var t = k.split('_')[0]; return istZiffern(t) ? parseInt(t, 10) : 0; }
    keys.sort(function (a, b) { return (sk(a) - sk(b)) || vergleich(a, b); });
    var punkte = [], summe = [0, 0, 0, 0, 0];
    keys.forEach(function (key) {
      var st = status[key][0], nb = status[key][1], k = koo[key];
      var p = key.lastIndexOf('_S');
      if (!k) return;
      punkte.push([key.slice(0, p), parseInt(key.slice(p + 2), 10), k[0], k[1], k[2], st, nb]);
      summe[st] += 1;
    });
    var s = {};
    NAMEN.forEach(function (n, i) { s[n] = summe[i]; });
    return { bohrstand: { stand: stand, legende: NAMEN.slice(), summe: s, punkte: punkte }, koo: koo };
  }

  /* ══════════ build_baustand.py ══════════ */
  function tagIso(wert) {
    var s = (wert || '').trim();
    if (!s || s === '—' || s === '-') return '';
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (m) return m[3] + '-' + ('0' + (+m[2])).slice(-2) + '-' + ('0' + (+m[1])).slice(-2);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var roh = s.charAt(s.length - 1) === 'Z' ? s.slice(0, -1) : s;
    var t = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?([+-]\d{2}:\d{2})?$/.exec(roh);
    if (t && +t[2] >= 1 && +t[2] <= 12 && +t[3] >= 1 && +t[3] === new Date(Date.UTC(+t[1], +t[2] - 1, +t[3])).getUTCDate()
          && +t[4] < 24 && +(t[5] || 0) < 60 && +(t[6] || 0) < 60) {     /* sonst ValueError in Python → s[:10] */
      var ms = Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +(t[5] || 0), +(t[6] || 0), t[7] ? Math.floor(+('0.' + t[7]) * 1000) : 0);
      if (t[8]) { var vz = t[8].charAt(0) === '-' ? -1 : 1; ms -= vz * ((+t[8].slice(1, 3)) * 60 + (+t[8].slice(4, 6))) * 60000; }
      var dt = new Date(ms);
      if (!isNaN(dt.getTime())) return zuerichTag(dt);
    }
    return s.slice(0, 10);
  }
  function bauBaustand(csvText, stand) {
    var d = csvDict(csvText);
    if (d.felder.indexOf('Nr.') < 0) throw new Error('baustand: Spalte Nr. fehlt');
    var st = {};
    d.rows.forEach(function (r) {
      if (g(r, 'Nr.') === null) throw new Error('baustand: Zeile ohne Nr.');
      var tid = r['Nr.'].trim();
      var pk = tagIso(g(r, 'Primärkonstruktion montiert'));
      var mt = tagIso(g(r, 'Modulträger montiert'));
      var vs = tagIso(g(r, 'Modultisch verschraubt'));
      if (pk === '' || pk === '—' || pk === '-') return;
      var e = { s: (mt !== '' && mt !== '—' && mt !== '-') ? 'mt' : 'pk', pk: pk };
      if (e.s === 'mt') e.mt = mt;
      if (vs !== '' && vs !== '—' && vs !== '-') e.vs = vs;
      st[tid] = e;
    });
    return { stand: stand, quelle: 'export-tableId-' + stand + '.csv', tische: st };
  }

  /* ══════════ bereiche_bauen() in nalpi_stand_api.py ══════════ */
  var BEREICH_SPALTE = 'Bauphasen_STRABAG_260410';
  function bauBereiche(csvText, stand) {
    var d = csvDict(csvText);
    if (d.felder.indexOf(BEREICH_SPALTE) < 0) throw new Error('bereiche: Spalte fehlt');
    var neu = {};
    d.rows.forEach(function (r) {
      var tid = txt(g(r, 'Nr.')), b = txt(g(r, BEREICH_SPALTE));
      if (tid && b) neu[tid] = b;
    });
    var keys = Object.keys(neu);
    if (!keys.length) throw new Error('bereiche: Spalte leer');   /* der Builder liesse den alten Stand stehen */
    var raus = {};
    keys.sort(vergleich).forEach(function (k) { raus[k] = neu[k]; });
    return { stand: stand, quelle: 'api.buildtrack.ch /api/w1/exports/table-id.csv, Spalte ' + BEREICH_SPALTE, bereiche: raus };
  }

  /* ══════════ build_modultische_api.py ══════════ */
  var MT_SPALTEN = 'table_key,geometry_code,year,module_amount,h_soll,center_e,center_n,center_h,' +
                   's1_e,s1_n,s1_h,s2_e,s2_n,s2_h,s3_e,s3_n,s3_h,s4_e,s4_n,s4_h,withdrawn_on';
  var MT_NOETIG = ['center_e', 'center_n', 'center_h', 'h_soll', 's1_e', 's1_n', 's1_h', 's2_e', 's2_n', 's2_h',
                   's3_e', 's3_n', 's3_h', 's4_e', 's4_n', 's4_h'];
  function azimut(r) {
    var be = (r.s2_e + r.s3_e) / 2.0, bn = (r.s2_n + r.s3_n) / 2.0;
    var te = (r.s1_e + r.s4_e) / 2.0, tn = (r.s1_n + r.s4_n) / 2.0;
    return pyMod(Math.atan2(te - be, tn - bn) * (180.0 / Math.PI), 360.0);
  }
  function mtZeile(r) {
    if (!('table_key' in r)) throw new Error('tables: table_key fehlt');
    for (var i = 0; i < MT_NOETIG.length; i++) if (r[MT_NOETIG[i]] === null || r[MT_NOETIG[i]] === undefined) return null;
    var code = pyWahr(r.geometry_code) ? pyStr(r.geometry_code) : '';
    var typ = code ? code.slice(0, 1).toUpperCase() + '_' + (pyWahr(r.year) ? pyStr(r.year) : '') : '';
    var m = r.module_amount, laenge = (m === 8) ? 10.007 : (m === 10) ? 12.394 : 12.394;
    var pf = [1, 2, 3, 4].map(function (i) { return [pyRound(r['s' + i + '_e'], 3), pyRound(r['s' + i + '_n'], 3), pyRound(r['s' + i + '_h'], 3)]; });
    return [pyStr(r.table_key).trim(), pyRound(r.center_e, 3), pyRound(r.center_n, 3), pyRound(r.center_h, 3),
            pyRound(azimut(r), 2), laenge, typ, pyRound(r.h_soll, 3), pf];
  }
  function mtSchluessel(a, b) {
    var da = istZiffern(a), db = istZiffern(b);
    if (da !== db) return da ? -1 : 1;
    return da ? (parseInt(a, 10) - parseInt(b, 10)) : vergleich(a, b);
  }
  function bauModultische(rohe) {
    if (!Array.isArray(rohe)) throw new Error('tables: keine Liste');
    var neu = new Map();
    rohe.forEach(function (r) {
      if (pyWahr(r.withdrawn_on)) return;
      var z = mtZeile(r);
      if (z) neu.set(z[0], z);
    });
    var vals = Array.from(neu.values());
    vals.sort(function (a, b) { return mtSchluessel(a[0], b[0]); });
    return vals;
  }

  /* ══════════ build_ps_tal.py ══════════ */
  var PS_SPALTEN = 'foundation_id,table_key,leg,abs_length,approval_status,order_batch_no,' +
                   'wrong_delivery_unresolved,calc_stale,geometry_stale';
  var TISCH_SPALTEN = 'table_key,geometry_code,bereich_key,assembled_on,preassembled_on,withdrawn_on';
  var BEKANNT = {
    '370_S1': ['weg', 'Zu kurz: Pfahl S1 abgesackt (-518 mm). Am Tisch steckt 1076_S4 als Spender ' +
                      '(Entscheid 06.08.2026). Nalpi fuehrt noch die alte Laenge.', 2358, 'entsorgen']
  };
  function zahlAus(v) {               /* float(v) */
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    var f = pyFloat(v);
    if (f === null) throw new Error('float: ' + v);
    return f;
  }
  function bestellungen(datenText) {
    var marke = 'window.NALP_PS_DATEN = ';
    var a = datenText.indexOf(marke);
    if (a < 0) throw new Error('ps_tal: NALP_PS_DATEN fehlt');
    var daten = JSON.parse(datenText.slice(a + marke.length, datenText.lastIndexOf('}') + 1));
    var b = {};
    (daten.bestellungen || []).forEach(function (z) {
      var t = pyStr(z[0]);
      var key = (istZiffern(t) ? String(parseInt(t, 10)) : t) + '_' + pyStr(z[1]);
      (b[key] = b[key] || []).push([pyStr(z[3]), pyRound(zahlAus(z[2]), 1), (z[6] === 1 || z[6] === true || z[6] === '1') ? 1 : 0]);
    });
    return b;
  }
  function bauPsTal(ps, tische, datenText, jetzt) {
    if (!Array.isArray(ps) || !Array.isArray(tische)) throw new Error('ps_tal: keine Liste');
    if (ps.length < 1000 || tische.length < 1000) throw new Error('ps_tal: zu wenig Zeilen');
    var p = {};
    ps.forEach(function (r) {
      var key = r.foundation_id;
      if (!pyWahr(key)) return;
      var flags = 0;
      if (pyWahr(r.calc_stale) || pyWahr(r.geometry_stale)) flags |= 1;
      if (pyWahr(r.wrong_delivery_unresolved)) flags |= 2;
      if (r.approval_status === 'Approved') flags |= 4;
      var l = r.abs_length;
      p[key] = [(l !== null && l !== undefined) ? pyRound(zahlAus(l), 1) : null, flags, pyWahr(r.order_batch_no) ? r.order_batch_no : ''];
    });
    var t = {};
    tische.forEach(function (r) {
      if (!('table_key' in r)) throw new Error('ps_tal: table_key fehlt');
      function od(v) { return pyWahr(v) ? v : ''; }
      t[pyStr(r.table_key)] = [od(r.bereich_key), od(r.geometry_code), od(r.assembled_on), od(r.preassembled_on), pyWahr(r.withdrawn_on) ? 1 : 0];
    });
    return sortiert({
      stand: zuerichMinute(jetzt || new Date()),
      quelle: 'api.buildtrack.ch /api/w1/q/passstuecke + /tables; Bestellungen 2026 aus nalp-passstueck-daten.js',
      p: p, t: t, b: bestellungen(datenText), bekannt: BEKANNT
    });
  }

  /* ══════════ maengel_snapshot.py ══════════ */
  var MG_ABFRAGE = 'select=display_no,kind,entity_type,entity_key,title,severity,status,created_on,beheben_bis' +
                   '&status=in.(OFFEN,IN_BEARBEITUNG)&entity_type=in.(table,drillpoint)&order=display_no';
  function bauMaengel(pendent) {
    if (!Array.isArray(pendent)) throw new Error('maengel: keine Liste');
    function v(m, k) { return m[k] === undefined ? null : m[k]; }
    var schlank = pendent.map(function (m) {
      var key = v(m, 'entity_key');
      return {
        nr: v(m, 'display_no'), art: v(m, 'entity_type'), key: key,
        tisch: (pyWahr(key) ? key : '').split('_')[0],
        titel: v(m, 'title'), schwere: v(m, 'severity'), status: v(m, 'status'), kind: v(m, 'kind'),
        erfasst: pyWahr(m.created_on) ? m.created_on : '',
        von: null,
        frist: pyWahr(m.beheben_bis) ? m.beheben_bis : null
      };
    });
    schlank.sort(function (a, b) {
      return vergleich(zfill(a.tisch, 6), zfill(b.tisch, 6)) || vergleich(pyWahr(a.key) ? a.key : '', pyWahr(b.key) ? b.key : '');
    });
    return { quelle: 'api.buildtrack.ch /api/w1/q/maengel (Nalpi-Maengelmanagement)', anzahl: schlank.length, maengel: schlank };
  }

  var BAU = { pyRound: pyRound, pyMod: pyMod, csvZeilen: csvZeilen, csvDict: csvDict, tagIso: tagIso,
              bauBohrstand: bauBohrstand, bauBaustand: bauBaustand, bauBereiche: bauBereiche, bauModultische: bauModultische,
              bauPsTal: bauPsTal, bauMaengel: bauMaengel, zuerichTag: zuerichTag, zuerichMinute: zuerichMinute };
  if (typeof module !== 'undefined' && module.exports) { module.exports = BAU; return; }
  if (!root.document) return;

  /* ══════════ Im Browser ══════════ */
  if (root.nalpLive) return;           /* doppelt eingebunden: die erste Fassung gilt */
  var PORTAL = root.location.host === 'portal.buildtrack.ch' || (function () {   /* derselbe Test wie nalp-buildtrack.js */
    try { if (root.localStorage.getItem('nalp_portal_test') === '1') return true; } catch (e) { /* kein localStorage */ }
    return /[?&]portal=1(&|#|$)/.test(root.location.search || '');
  })();
  var SELBST = (document.currentScript && document.currentScript.src) || '';
  var ORDNER = SELBST ? SELBST.replace(/[^\/]*$/, '') : 'assets/js/';
  var CSV_BOHR = '/api/w1/exports/drilling-point-data.csv', CSV_TISCH = '/api/w1/exports/table-id.csv';
  var LANG = { timeout: 30000 };

  /* nalpBT abwarten bzw. nachladen (wie nalp-gate.js) — null, wenn es nicht kommt. */
  var btP = null;
  function btHolen() {
    if (btP) return btP;
    btP = new Promise(function (fertig) {
      function da() { return root.nalpBT && root.nalpBT.sitzung ? root.nalpBT : null; }
      if (da()) { fertig(da()); return; }
      function weiter() {
        if (da()) { fertig(da()); return; }
        if (!document.querySelector('script[src*="nalp-buildtrack.js"]')) {
          var s = document.createElement('script');
          s.src = ORDNER + 'nalp-buildtrack.js';
          (document.head || document.documentElement).appendChild(s);
        }
        var bis = Date.now() + 15000;
        (function warten() {
          if (da()) fertig(da()); else if (Date.now() > bis) fertig(null); else setTimeout(warten, 40);
        })();
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', weiter); else weiter();
    });
    return btP;
  }

  /* Ein Export als Text + sein Tag (content-disposition, sonst heute in Zuerich) — einmal je Seitenaufruf. */
  var csvCache = {};
  function csvHolen(bt, pfad) {
    if (!csvCache[pfad]) {
      csvCache[pfad] = bt.datei(pfad, { accept: 'text/csv', timeout: 60000 }).then(function (r) {
        var m = /(\d{4}-\d{2}-\d{2})/.exec(r.headers.get('content-disposition') || '');
        var tag = m ? m[1] : zuerichTag(new Date());
        return r.text().then(function (t) {
          if (t.replace(/^﻿/, '').charAt(0) !== '"') throw new Error(pfad + ': keine CSV');   /* wie nalpi_stand_api.holen() */
          return { text: t, tag: tag };
        });
      });
      csvCache[pfad].catch(function () { delete csvCache[pfad]; });
    }
    return csvCache[pfad];
  }
  var bohrP = null;
  function bohr(bt) {
    if (!bohrP) {
      bohrP = csvHolen(bt, CSV_BOHR).then(function (c) { return bauBohrstand(c.text, c.tag); });
      bohrP.catch(function () { bohrP = null; });
    }
    return bohrP;
  }
  function datenText() {
    return fetch(ORDNER + 'nalp-passstueck-daten.js').then(function (r) { if (!r.ok) throw new Error('daten ' + r.status); return r.text(); });
  }
  function enc(s) { return encodeURIComponent(s); }

  var LIVE = {
    'uploads/tables/bohrstand.json': function (bt) { return bohr(bt).then(function (x) { return x.bohrstand; }); },
    'uploads/tables/bohrpunkte_koo.json': function (bt) { return bohr(bt).then(function (x) { return x.koo; }); },
    'uploads/tables/baustand.json': function (bt) { return csvHolen(bt, CSV_TISCH).then(function (c) { return bauBaustand(c.text, c.tag); }); },
    'uploads/tables/bereiche.json': function (bt) { return csvHolen(bt, CSV_TISCH).then(function (c) { return bauBereiche(c.text, c.tag); }); },
    'uploads/tables/modultische_all.json': function (bt) {
      return bt.q('tables', 'select=' + enc(MT_SPALTEN) + '&order=table_key', LANG).then(bauModultische);
    },
    'uploads/tables/ps_tal.json': function (bt) {
      return Promise.all([bt.q('passstuecke', 'select=' + enc(PS_SPALTEN), LANG), bt.q('tables', 'select=' + enc(TISCH_SPALTEN), LANG), datenText()])
        .then(function (a) { return bauPsTal(a[0], a[1], a[2], new Date()); });
    },
    'uploads/maengel.json': function (bt) { return bt.q('maengel', MG_ABFRAGE, LANG).then(bauMaengel); }
  };

  function schluessel(url) {
    var s = String(url || '');
    try {
      var u = new URL(s, root.location.href);
      if (u.origin !== root.location.origin) return '';
      s = u.pathname;
    } catch (e) { s = s.split(/[?#]/)[0]; }
    return s.replace(/^\.?\/+/, '');
  }

  var gebaut = {};          /* Pfad → Promise<Text des gebauten JSON>, einmal je Seitenaufruf */
  function bauen(key, bt) {
    if (!gebaut[key]) {
      gebaut[key] = LIVE[key](bt).then(function (o) { return JSON.stringify(o); });
      gebaut[key].catch(function () { delete gebaut[key]; });
    }
    return gebaut[key];
  }

  function holen(url, opts) {
    var key = PORTAL ? schluessel(url) : '';
    if (!key || !LIVE[key]) return fetch(url, opts);             /* ausserhalb des Portals: genau wie bisher */
    return btHolen().then(function (bt) {
      if (!bt || !bt.PORTAL || !bt.datei) return null;
      return bt.sitzung().then(function () { return bt.modus() ? bauen(key, bt) : null; });
    }).then(function (text) {
      if (text === null) return fetch(url, opts);
      return new Response(text, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'x-nalp-live': '1' } });
    }, function (e) {
      try { console.warn('nalp-live: ' + key + ' live nicht gebaut (' + ((e && e.message) || e) + ') – mitgelieferte Datei.'); } catch (x) {}
      return fetch(url, opts);
    });
  }

  root.nalpLive = {
    fetch: holen,
    json: function (url, opts) { return holen(url, opts).then(function (r) { return r.json(); }); },
    pfade: Object.keys(LIVE),
    _bau: BAU
  };
})(typeof window !== 'undefined' ? window : this);
