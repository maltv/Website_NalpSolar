// nalp-passstueck-tal.js — Entscheid «wird das Stück noch gebraucht?» für ps-tal.html (Passstück-Check Tal).
// EINE Stelle für die Regel: die Seite ruft urteil() je gescanntem Etikett, die Batch-Übersicht ruft
// batches(), und dieselbe Datei läuft in Node für Tests und Auswertungen (module.exports).
// Daten: uploads/tables/ps_tal.json (tools/build_ps_tal.py, Felder dort beschrieben).
// Name mit «nalp-passstueck-»: der Service Worker holt solche Dateien network-first (sw.js), Änderungen
// kommen also ohne Cache-Hochzählen an.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NALP_PS_TAL = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOL = 3;   // mm: Etikett = ganze mm, Nalpi rechnet mit Kommastellen, Batch 3/4 wurden mit Kommastellen bestellt

  function ist2025(typ) { return /2025/.test(String(typ || '')); }

  /* Wohin ein überzähliges Stück geht – Regel Christian Schmuckle 19.08.2026 («Stahlteile zur Rückführung»):
     Typ B 2025 → Mauchle (Sursee), A/D/E 2025 → durch uns entsorgen. Für die Serie 2026 gibt es keine Regel. */
  function ziel(typ) {
    var t = String(typ || '');
    if (ist2025(t) && /^B/i.test(t)) return 'mauchle';
    if (ist2025(t)) return 'entsorgen';
    return 'klaeren';
  }

  function nah(a, b) { return a != null && b != null && Math.abs(+a - +b) <= TOL; }

  /* Ergebnis: { klasse: 'behalten' | 'weg' | 'pruefen', grund, ziel, … }
     grund (für die Texte der Seite):
       gebraucht         Tisch steht noch nicht, Länge = Soll
       montiert          Tisch steht, Länge ≠ Soll → übrig
       montiert_soll     Tisch steht, Länge = Soll → am Tisch nachsehen (Doppel / Tausch offen?)
       ersetzt           Tisch steht nicht, Länge = alte, neu bestellte Position
       passt_nicht       Tisch steht nicht, Soll ist freigegeben und anders
       nicht_berechnet   noch kein Soll → vorerst behalten
       nicht_freigegeben Soll berechnet, aber nicht freigegeben → vorerst behalten
       veraltet          Nalpi: Berechnung veraltet → behalten bis neu gerechnet
       widerspruch       Tisch steht nicht, Nalpi-Länge ≠ letzte Bestellung, Stück passt zu einer → messen
       zurueckgezogen    Tisch zurückgezogen
       tisch_unbekannt   Tisch-ID gibt es nicht
       bekannt           Einzelfall aus build_ps_tal.py (Text mitgeliefert) */
  function urteil(D, tisch, stuetze, laenge) {
    var id = String(parseInt(tisch, 10)), s = String(stuetze || '').toUpperCase(), L = +laenge;
    var key = id + '_' + s;
    var t = D.t[id], p = D.p[key], best = D.b[key] || [], bek = (D.bekannt || {})[key];
    var r = { key: key, tisch: id, s: s, l: L, klasse: 'pruefen', grund: '', ziel: '',
      bereich: t ? t[0] : '', typ: t ? t[1] : '', montiert: t ? t[2] : '', vormontiert: t ? t[3] : '',
      soll: p ? p[0] : null, batch: '', neu: null, nachmessen: false, text: '' };
    if (!t) { r.grund = 'tisch_unbekannt'; return r; }

    // Zu welcher Bestellung passt die Länge? (bei mehreren: die gültige)
    var treffer = null, gueltig = null, i;
    for (i = 0; i < best.length; i++) {
      if (best[i][2] === 1) gueltig = best[i];
      if (nah(best[i][1], L) && (!treffer || best[i][2] > treffer[2])) treffer = best[i];
    }
    if (treffer) r.batch = treffer[0];
    if (gueltig && (!treffer || treffer[2] === 0)) r.neu = { batch: gueltig[0], l: gueltig[1] };

    if (bek && (bek[2] == null || nah(bek[2], L))) {
      r.klasse = bek[0]; r.grund = 'bekannt'; r.text = bek[1]; r.ziel = bek[3] || (bek[0] === 'weg' ? ziel(r.typ) : '');
      return r;
    }
    if (t[4]) { r.grund = 'zurueckgezogen'; return r; }

    /* Zwei Quellen für die richtige Länge: Nalpi (soll) und die letzte gültige Bestellung. Nachbestellungen
       wegen verrutschter Pfähle (357 S2/S3, 1880 S2 – Batch 13) hat Nalpi nie übernommen; dort führt Nalpi noch
       die alte Länge. Widersprechen sich beide, wird nichts weggeworfen. */
    var flags = p ? p[1] : 0, soll = p ? p[0] : null, gl = gueltig ? gueltig[1] : null;
    var sollPasst = nah(soll, L) || nah(gl, L);
    var widerspruch = soll != null && gl != null && !nah(soll, gl);
    if (widerspruch) r.soll2 = gl;

    if (t[2]) {                                   // Tisch montiert
      if (sollPasst) { r.grund = 'montiert_soll'; return r; }
      r.klasse = 'weg'; r.grund = 'montiert'; r.ziel = ziel(r.typ); return r;
    }
    if (soll == null && gl == null) { r.grund = 'nicht_berechnet'; return r; }
    if (flags & 1) { r.grund = 'veraltet'; return r; }
    if (sollPasst && widerspruch) { r.grund = 'widerspruch'; return r; }
    if (sollPasst) {
      r.klasse = 'behalten'; r.grund = 'gebraucht'; r.nachmessen = !!(flags & 2); return r;
    }
    if (!(flags & 4)) { r.grund = 'nicht_freigegeben'; return r; }
    r.klasse = 'weg'; r.ziel = ziel(r.typ);
    r.grund = (treffer && treffer[2] === 0) ? 'ersetzt' : 'passt_nicht';
    return r;
  }

  /* Je Bestellbatch: steckt das Stück schon im Tisch (gültige Bestellung, Tisch montiert), sonst urteil() mit der
     bestellten Länge – so, als würde das Stück im Tal gescannt. Ein Batch ist «komplett weg», wenn kein Stück
     mehr «behalten» oder «prüfen» ist. Stücke aus 2025 (altes Etikett «Serie …») stehen in keiner Bestellliste
     2026 und fehlen hier – die entscheidet nur der Scan. */
  function batches(D) {
    var out = {}, keys = Object.keys(D.b);
    keys.forEach(function (key) {
      var teil = key.split('_'), id = teil[0], s = teil[1], t = D.t[id];
      D.b[key].forEach(function (o) {
        var b = String(o[0]);
        var e = out[b] || (out[b] = { batch: b, n: 0, verbaut: 0, weg: 0, behalten: [], pruefen: [] });
        e.n++;
        var p = D.p[key];
        /* Gültige Bestellung + Tisch montiert = steckt im Tisch. Ausnahme: die Position wurde NACHBESTELLT und Nalpi
           führt noch die alte Länge – dann ist der Tausch womöglich offen (357 S2/S3, 1880 S2). Weicht Nalpi bei einer
           einmal bestellten Position ab (Bereich 1.1/1.2/1.5, später neu gerechnet), wurde trotzdem das Bestellte gebaut. */
        var tauschOffen = D.b[key].length > 1 && p && p[0] != null && !nah(p[0], o[1]);
        if (o[2] === 1 && t && t[2] && !tauschOffen) { e.verbaut++; return; }
        var u = urteil(D, id, s, o[1]);
        if (u.klasse === 'weg') e.weg++;
        else if (u.klasse === 'behalten') e.behalten.push(u);
        else e.pruefen.push(u);
      });
    });
    delete out.RES;   // Reserve-Rohlinge (Sonderbestellung 06.08.) bleiben immer – nicht in die Übersicht
    return Object.keys(out).map(function (b) {
      var e = out[b];
      e.komplett = !e.behalten.length && !e.pruefen.length;
      return e;
    }).sort(function (a, c) {
      var x = parseInt(a.batch, 10), y = parseInt(c.batch, 10);
      if (isNaN(x)) return 1; if (isNaN(y)) return -1;
      return x - y;
    });
  }

  /* Etikett lesen. Mauchle-Etiketten tragen die Länge ZWEIMAL: «Position 469-S2-1216» und «Länge 1216mm».
     Stehen beide lesbar da und widersprechen sich, gilt das Bild nicht (OCR-Fehler). */
  function etikett(text) {
    var s = String(text || '').replace(/[|]/g, '1').replace(/\s+/g, ' ');
    var m = s.match(/(\d{2,4})\s*[-–—_]\s*[S5$]\s*([1-4])\s*[-–—_]\s*([0-9OIl]{3,4})\b/i);
    if (!m) return null;
    var fix = function (z) { return z.replace(/[Oo]/g, '0').replace(/[Il]/g, '1'); };
    var tisch = parseInt(m[1], 10), l = parseInt(fix(m[3]), 10);
    if (!(tisch >= 1 && tisch <= 9999) || !(l >= 100 && l <= 6000)) return null;
    var ml = s.match(/L[äaà]nge\s*:?\s*([0-9OIl]{3,4})\s*m/i);
    if (ml) {
      var l2 = parseInt(fix(ml[1]), 10);
      if (Math.abs(l2 - l) > 1) return null;
    }
    return { tisch: String(tisch), s: 'S' + m[2], l: l };
  }

  return { urteil: urteil, batches: batches, etikett: etikett, ziel: ziel, TOL: TOL };
}));
