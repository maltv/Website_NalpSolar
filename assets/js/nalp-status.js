/*
 * nalp-status.js — Baustellen-Stand & offene Probleme NalpSolar.
 *
 * QUELLENPFLICHT: Jeder Eintrag traegt eine `quelle`. Nur belegte Fakten,
 * keine Schaetzungen ohne Kennzeichnung. Stand 09.07.2026.
 * Interner Arbeitsstand (STRABAG B8-13) — KEINE offizielle AG-Kommunikation.
 *
 * Wird von index.html (Karte) und viewer3d.html (3D) genutzt:
 *  - NALP_STATUS.kpis     -> Kennzahlen-Kacheln
 *  - NALP_STATUS.themen   -> Liste offener Themen mit Quelle
 *  - NALP_STATUS.kategorien / NALP_STATUS.tischInfo(id) -> Einfaerbung im 3D
 */
(function () {
  'use strict';

  // ── Tisch-Kategorien (Farben fuer 2D-Karte & 3D-Viewer) ────────────────────
  var kategorien = {
    stopp: {
      label: 'Baustopp / Rückbau strittig',
      color: '#e5484d', icon: '⛔',
      kurz: 'Gebaut, ~470 mm zu tief. Protokoll 25.06.: Rückbau+Neu. ILF 02.07.: „bleiben vorerst bestehen" → Widerspruch (NO024).'
    },
    hoehe: {
      label: 'Falsche Höhe – gestoppt (Passstück neu)',
      color: '#ff8a3d', icon: '📏',
      kurz: 'Baustopp 23.06.: Sollhöhe zu tief. Absteckung/Bohrung bleiben, Passstücke neu rechnen+bestellen (Rev. A8, 02.07.).'
    },
    hoehe_lage: {
      label: 'Baupiste B – Neubohrung nötig',
      color: '#b45cff', icon: '🎯',
      kurz: 'Falsches Geländemodell (Axpo 11/25): Höhe + Lage falsch, neue Absteckung aller 4 Stützen + neue Bohrungen (alle Typ D).'
    },
    passstueck: {
      label: 'Passstück offen / nicht belegt',
      color: '#ffd23f', icon: '🧩',
      kurz: 'Passstück-Lieferung nicht erfasst (Mauchle) → Lagerort physisch prüfen. Nalpi-Status „geliefert" unzuverlässig.'
    },
    bestand: {
      label: 'Zu tief gebaut – bleibt vorerst',
      color: '#4a86c5', icon: '⏸',
      kurz: 'Zu tief gebaut, laut ILF-Mail 02.07. „bleiben vorerst bestehen" (19 Tische). Beobachten.'
    },
    prio: {
      label: 'Vorgezogene Montage (CKW-Prio)',
      color: '#35c46a', icon: '⚡',
      kurz: 'Von ILF/CKW vorgezogen montiert (Prio-Massnahmen ILF-Mail 02.07.).'
    }
  };

  // ── Tisch-IDs je Kategorie (alle belegt, s. Quelle im jeweiligen Thema) ─────
  // Reihenfolge = Schwere-Priorität bei Mehrfachnennung (erste gewinnt).
  var gruppen = [
    ['stopp',      [358, 379, 382]],
    ['hoehe_lage', [1006, 1007, 1008, 1012, 1013, 1014, 1838, 1839, 1840]],
    ['hoehe',      [326, 327, 342, 359, 361, 362, 381, 383]],
    ['passstueck', [2178, 415, 375, 2151]],
    ['bestand',    [402, 534, 1613, 1643, 1645, 2164, 2166, 2168, 1003, 1004, 1005, 1010, 1011, 1835, 1836, 1837]],
    ['prio',       [1625, 486, 485, 412, 390, 1623, 1620]]
  ];

  var tische = {};
  gruppen.forEach(function (g) {
    var key = g[0];
    g[1].forEach(function (id) {
      if (!(id in tische)) tische[String(id)] = key; // erste (schwerste) Nennung gewinnt
    });
  });

  // ── Kennzahlen (Stand 09.07.2026) ──────────────────────────────────────────
  var kpis = [
    {
      label: 'Bauprogramm-Verzug', wert: '≈ 50', einheit: 'Tage', ton: 'rot',
      detail: 'Entwurfs-Schätzung (mit „?"), Baupiste B kritisch 45 Tage.',
      quelle: 'Bauprogramm-Entwurf MEIZ 29.06.2026; Machbarkeitsprüfung STRABAG bis 08.07.'
    },
    {
      label: 'Bohrleistung', wert: '13,9', einheit: '/ 30 Soll', ton: 'rot',
      detail: 'Bohrungen pro Tag statt Ziel 30 (Bautempo-Diagramm).',
      quelle: 'Abstimmungssitzung 45, 06.07.2026'
    },
    {
      label: 'Geänderte Tische', wert: '130', einheit: 'seit 11.05.', ton: 'orange',
      detail: 'Typ/Lage geändert oder zu tief zurückgezogen. B=69, C=14, D=24, E=23 (kein Typ A).',
      quelle: 'Beilage_Tische_Aenderungen_2026.csv; Nalpi-Export 01.07.'
    },
    {
      label: 'Aktive Baustopps', wert: '2', einheit: 'offen', ton: 'rot',
      detail: 'Tischhöhen Bereich 1.2 (23.06.) + Baupiste Strang B.',
      quelle: 'Protokoll 25.06.; Bausitzung 11.06.'
    },
    {
      label: 'Nachtrag NO024', wert: "43’399.50", einheit: 'CHF – Antwort offen', ton: 'orange',
      detail: 'Ungeordneter Bauablauf Baustopp 23.06., eingereicht 02.07.',
      quelle: 'Nachtragsofferte NO024 (02.07.2026); Einschreiben Axpo 30.06.'
    }
  ];

  // ── Offene Themen / „Stand der Dinge" ───────────────────────────────────────
  var themen = [
    {
      id: 'stopp-hoehen', schwere: 'stopp', icon: '⛔',
      titel: 'Baustopp Tischhöhen – Bereich 1.2 (23.06.2026)',
      text: '11 Tische ~470 mm zu tief geplant (Berechnungsfehler Geländemodell). 3 schon gebaut → Rückbau+Neu strittig (358/379/382), 8 gestoppt → neue Passstücke. STRABAG hat den Kran bereits abgebaut/weggezügelt → muss neu gestellt werden. Bestellung→Bau Passstücke ≈ 8 Wochen.',
      datum: '23.06.2026', tische: [358, 379, 382, 326, 327, 342, 359, 361, 362, 381, 383],
      quelle: 'Anordnung Amstein+Walthert (Mail M. Meier 23.06. 14:10); Protokoll „Bauablauf nach Baustopp" 25.06./29.06.'
    },
    {
      id: 'stopp-baupiste-b', schwere: 'stopp', icon: '🎯',
      titel: 'Baustopp Baupiste Strang B – Neubohrungen',
      text: 'Rückbau mit falschem Axpo-Geländemodell (11/25) geplant → Tische zu tief, Passstücke bei 9 Tischen zu kurz (Pfahlabstand nur ~1,20 m). 9 kritische Tische brauchen komplett neue Absteckung + Bohrung (alle Typ D). 81 Tische im Strang betroffen.',
      datum: 'angezeigt 11./14.06.2026', tische: [1006, 1007, 1008, 1012, 1013, 1014, 1838, 1839, 1840],
      quelle: 'Bausitzung 11.06.; Protokoll 25.06.; Mehrkosten-Dossier'
    },
    {
      id: 'falsche-hoehen-pz2025', schwere: 'hoch', icon: '📏',
      titel: 'Falsche Höhen Perimeter 2025 – Passstücke neu',
      text: 'ILF stellte ab 16.01.2026 die Passstückberechnung auf die SOLL-Höhe (UK-Modul) um → gelieferte Passstücke passen nicht mehr. Gruppe 1 (nur Höhe): 326/327/342/359/361/362/381/383. Rev. A8 geliefert 02.07., Rev. A9 (Rest Baupiste B) für 10.07. angekündigt. WICHTIG: alte Passstücke am IP1-Lager NICHT verbauen.',
      datum: 'Rev. A8: 02.07.2026', tische: [326, 327, 342, 359, 361, 362, 381, 383],
      quelle: 'Ankermail F. Borner 06.05.; ILF-Mail 02.07.; Dossier Pendenzen_1.1_1.2_1.3'
    },
    {
      id: 'passstuecke-offen', schwere: 'hoch', icon: '🧩',
      titel: 'Passstück-Erfassung fehlt – Lagerorte unklar',
      text: 'Die Erfassung der Passstück-Lieferungen (Mauchle) wird nicht gepflegt → Nalpi-Status „geliefert" ist unzuverlässig, Lagerorte müssen physisch verifiziert werden. Offene Tische 1.1/1.2: 2178 (schräg montiert, Ersatz-S2), 415 (Modulträger offen), 375 + 2151 (am IP1 suchen). 390 geklärt (2025er-Konstruktion gültig).',
      datum: 'Stand 09.07.2026', tische: [2178, 415, 375, 2151],
      quelle: 'Abstimmungssitzung 45 (06.07.); F. Borner 19.06./08.07.; Pendenzenblatt 1.1/1.2 09.07.'
    },
    {
      id: 'werkleitungen-d', schwere: 'hoch', icon: '🔵',
      titel: 'Werkleitungen Strang D stehen still',
      text: 'Pläne pendent („Wir können nicht weiterbauen"). Planlieferverzug 2 Wochen anzumelden. Ebenso Tiefbau Perimeter 2027-PZ3: 2 Wochen Planlieferverzug. Haupt-KRB bis Schacht D1 am 06.07. freigegeben.',
      datum: '06.07.2026', tische: [],
      quelle: 'Abstimmungssitzung 45 (06.07.); Mail Borner/Schmuckle 06.07.'
    },
    {
      id: 'material-pfaehle', schwere: 'mittel', icon: '📦',
      titel: 'Material: Pfähle Typ C/D waren aus',
      text: 'Pfähle Typ C/D (Vulkanox) ausverkauft → Einbau-Stopp (21.06.), Lieferung 330 Stk erst 01.07. Passstücke Batch 1 fehlten; Anpassteile 4.1/4.2 erst nach Abschluss der Bohrungen bestellbar.',
      datum: '21.06.–01.07.2026', tische: [],
      quelle: 'Mail Borner 21.06.; Mail Kaelin 01.07.'
    },
    {
      id: 'programm-zurueckgestellt', schwere: 'info', icon: '🗓',
      titel: 'Änderungsbereiche zurückgestellt – eigenes Programm zuerst',
      text: 'Telefonat Victor–François 07.07.: Die Planeränderungen in 1.2/1.3 und Baupiste B werden zurückgestellt („stehen ganz hinten an"). STRABAG fährt zuerst das eigene Bauprogramm weiter – die Änderungsbereiche kommen nachgelagert, kann auch Oktober 2026 werden. Passt zur ILF-Linie „19 zu tiefe Tische bleiben vorerst bestehen".',
      datum: '07.07.2026', tische: [],
      quelle: 'Telefonat Victor–François 07.07.2026 (mündlich, kein Schriftstück)'
    },
    {
      id: 'sperrung-juli', schwere: 'info', icon: '🚧',
      titel: 'Strassensperrung 22.–24.07. (CKW-Kabelzüge)',
      text: 'Angekündigte Sperrung wegen CKW-Kabelzügen. Zusätzlich UBB-Punkte gemeldet (07.07.).',
      datum: '22.–24.07.2026', tische: [],
      quelle: 'Mail 07.07.2026; Strassensperr-Anzeigen'
    }
  ];

  window.NALP_STATUS = {
    stand: '2026-07-09',
    standLabel: '9. Juli 2026',
    hinweis: 'Interner Arbeitsstand STRABAG B8-13. Alle Angaben quellenbelegt; keine offizielle AG-Kommunikation.',
    kategorien: kategorien,
    tische: tische,
    kpis: kpis,
    themen: themen,
    tischInfo: function (id) {
      var key = tische[String(id)];
      if (!key) return null;
      var meta = kategorien[key];
      return { key: key, label: meta.label, color: meta.color, icon: meta.icon, kurz: meta.kurz };
    }
  };
})();
