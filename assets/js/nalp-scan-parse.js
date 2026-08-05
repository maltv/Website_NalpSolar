// nalp-scan-parse.js — Etikett-Parser für die Passstück-Kamera-Erfassung.
// Erwartete Etikett-Reihenfolge (oben nach unten):
//   1. Position   z. B. "1891_S2"  (Tisch_Stütze)
//   2. ID         z. B. "24027-1153" (Mauchle-Teil-/Auftragsnr., frei alphanumerisch)
//   3. Bohrpunkt  z. B. "BP 10"    (1–12, seit Lieferung 07/2026 auch zweistellig!)
//   4. Länge      z. B. "3245 mm"  (300–4500 mm)
// Läuft im Browser (window.NALP_SCAN) und in Node (module.exports) für Tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NALP_SCAN = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BP_MAX = 12;          // Bohrpunkte: bisher 1–9, neu bis 10 (Reserve 12)
  var LEN_MIN = 300, LEN_MAX = 4500;   // plausible Passstücklängen in mm
  var TISCH_MIN = 100, TISCH_MAX = 9999;

  // OCR-Zeile grob säubern (LSTM-typische Verwechsler nur dort, wo eindeutig).
  function cleanLine(s) {
    return String(s || '')
      .replace(/[|]/g, 'I')
      .replace(/[·••]/g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Ziffernkontext-Normalisierung: O→0, I/l→1, S→5 NUR innerhalb reiner Zahlwörter.
  function numFix(tok) {
    return tok.replace(/[OoIlSB]/g, function (c) {
      return { O: '0', o: '0', I: '1', l: '1', S: '5', B: '8' }[c];
    });
  }

  // "1891_S2", "1891-S2", "1891 S2", auch OCR-Varianten "1891_52"/"1891_$2"
  var RE_POS = /(\d{3,4})\s*[_\-\s]\s*[S5$]\s*([1-4])\b/;

  function parsePosition(line) {
    var m = RE_POS.exec(line);
    if (!m) return null;
    var tisch = parseInt(m[1], 10);
    if (tisch < TISCH_MIN || tisch > TISCH_MAX) return null;
    return { tisch: tisch, stuetze: 'S' + m[2], pos: tisch + '_S' + m[2] };
  }

  function parseBohrpunkt(line) {
    // bevorzugt mit Etikett-Präfix …
    var m = /(?:BP|B\.?\s?P\.?|BOHRPUNKT|BOHRP|BOHRUNG)\s*[.:]?\s*([0-9OIl]{1,2})/i.exec(line);
    if (!m) {
      // … sonst nackte kleine Zahl (eigene Zeile)
      var t = numFix(line.replace(/[^0-9OIlSB]/g, ''));
      if (!/^\d{1,2}$/.test(t)) return null;
      m = [null, t];
    }
    var v = parseInt(numFix(m[1]), 10);
    return (v >= 1 && v <= BP_MAX) ? v : null;
  }

  function parseLaenge(line) {
    // "3245 mm", "L=3245", "3245"
    var m = /(?:L\s*[=.:]?\s*)?([0-9OIlSB]{3,4})\s*(?:MM|mm)?\s*$/.exec(line.trim());
    if (!m) return null;
    var v = parseInt(numFix(m[1]), 10);
    return (v >= LEN_MIN && v <= LEN_MAX) ? v : null;
  }

  // Hauptfunktion: roher OCR-Text → Felder + Warnungen.
  // Strategie: Zeilenreihenfolge des Etiketts nutzen, aber jede Zuordnung
  // einzeln plausibilisieren; nichts stillschweigend raten.
  function parseLabel(raw) {
    var lines = String(raw || '').split(/\n+/).map(cleanLine).filter(Boolean);
    var out = { pos: '', tisch: null, stuetze: '', id: '', bp: null, laenge: null, warn: [] };
    var used = lines.map(function () { return false; });
    var i, p;

    // 1) Position: erste Zeile, die dem Muster entspricht
    for (i = 0; i < lines.length; i++) {
      p = parsePosition(lines[i]);
      if (p) { out.pos = p.pos; out.tisch = p.tisch; out.stuetze = p.stuetze; used[i] = true; break; }
    }
    var posIdx = out.pos ? i : -1;
    if (!out.pos) out.warn.push('Position (Tisch_Stütze) nicht erkannt');

    // 2) Bohrpunkt: erste passende Zeile NACH der Position (Etikett-Reihenfolge),
    //    sonst irgendwo; BP-Präfix gewinnt vor nackter Zahl.
    var bpIdx = -1;
    for (i = 0; i < lines.length; i++) {
      if (used[i]) continue;
      if (/BP|BOHR/i.test(lines[i])) {
        var v1 = parseBohrpunkt(lines[i]);
        if (v1 !== null) { out.bp = v1; bpIdx = i; used[i] = true; break; }
      }
    }
    if (out.bp === null) {
      for (i = posIdx + 1; i < lines.length; i++) {
        if (used[i]) continue;
        var t = lines[i].replace(/[^0-9OIlSB]/g, '');
        if (t.length >= 3) continue;            // 3-4-stellig = eher Länge/ID
        var v2 = parseBohrpunkt(lines[i]);
        if (v2 !== null) { out.bp = v2; bpIdx = i; used[i] = true; break; }
      }
    }
    if (out.bp === null) out.warn.push('Bohrpunkt nicht erkannt (1–' + BP_MAX + ', neu auch 10!)');

    // 3) Länge: LETZTE plausible Zahl 300–4500 (Etikett: Länge zuunterst)
    for (i = lines.length - 1; i >= 0; i--) {
      if (used[i]) continue;
      var v3 = parseLaenge(lines[i]);
      if (v3 !== null) { out.laenge = v3; used[i] = true; break; }
    }
    if (out.laenge === null) out.warn.push('Länge nicht erkannt (' + LEN_MIN + '–' + LEN_MAX + ' mm)');

    // 4) ID: erste unbenutzte Zeile zwischen Position und Bohrpunkt/Länge,
    //    die mind. 3 Zeichen hat und nicht nur Beiwerk ist.
    var von = posIdx + 1, bis = (bpIdx > 0 ? bpIdx : lines.length);
    for (i = Math.max(0, von); i < bis; i++) {
      if (used[i]) continue;
      var s = lines[i].replace(/^(ID|NR|NO|ART)[.:]?\s*/i, '').trim();
      if (s.length >= 3 && /\d/.test(s)) { out.id = s; used[i] = true; break; }
    }
    if (!out.id) {
      for (i = 0; i < lines.length; i++) {
        if (used[i]) continue;
        var s2 = lines[i].replace(/^(ID|NR|NO|ART)[.:]?\s*/i, '').trim();
        if (s2.length >= 5 && /\d/.test(s2)) { out.id = s2; used[i] = true; break; }
      }
    }
    if (!out.id) out.warn.push('ID nicht erkannt');

    return out;
  }

  return {
    parseLabel: parseLabel,
    parsePosition: parsePosition,
    parseBohrpunkt: parseBohrpunkt,
    parseLaenge: parseLaenge,
    BP_MAX: BP_MAX, LEN_MIN: LEN_MIN, LEN_MAX: LEN_MAX
  };
}));
