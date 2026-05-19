# NalpSolar Karte: Arbeitskontext fuer Folgeaenderungen

## Ziel dieses Dokuments
Schneller Einstieg fuer weitere Anpassungen an `index.html` mit minimalem Kontextbedarf (Token sparen).

## Projektstatus (Stand: 2026-05-19)
- Single-file App: **`index.html`** (Leaflet 1.9.4, keine Build-Tools).
- Zusaetzliche Datendatei: **`export-tableId-2026-05-18.csv`**.
- Alles laeuft clientseitig im Browser.
- Die effektiven Tischtypen aus CSV sind bereits in den GeoJSON-Tabellen (`pz1Data`, `pz2Data`, `pz2025Data`) eingepflegt.

## Wichtige Dateien
- **`/workspaces/Website_NalpSolar/index.html`**
  - Enthaelt:
    - komplette UI
    - alle Layer/Controls
    - eingebettete GeoJSON-Daten
    - Suchfunktion
    - GPS
    - Feld-Richtungsnavigation (Pfeil + Linie)
    - bereits korrigierte `tisch_typ` Werte in den Modultischdaten
- **`/workspaces/Website_NalpSolar/export-tableId-2026-05-18.csv`**
  - Quelle fuer effektive Modultisch-Typen
  - relevante Spalten:
    - `Nr.` = Tisch-ID
    - `Typ` = effektiver Typ

## Aktuelle Kernfunktionen
- Layer:
  - Bereiche
  - Modultische (PZ1, PZ2, PZ2025)
  - Kranradien + Kranlabels + Mittelpunkte
- UI:
  - GPS Button
  - `Alle` Button
  - ID-Suche
  - gruppiertes Layerfenster
  - kompakte Legende unten rechts fuer Typfarben A-E
- Labels:
  - Tisch-Labels mit schwarzem Text + weissem Halo
  - Tisch-Labels parallel zur jeweiligen Tischlinie ausgerichtet
  - Labels sind erst ab Zoomstufe 18 sichtbar
- Typflaechen der Tische:
  - pro Tisch wird aus der bestehenden Linie ein Rechteck (ca. 3m nach hinten) erzeugt
  - Einfaerbung nach Grundtyp `A/B/C/D/E`
  - Schraffur nach Suffix:
    - `_2025` = 45° nach rechts geneigt
    - `_KF2025` = 45° nach links geneigt
  - Schraffur ist global orientiert (nicht von der Tischausrichtung abhaengig)
- Navigation im Feld (kein Google Maps Routing):
  - Popup-Button `Richtung anzeigen`
  - Zielmarker
  - gestrichelte Linie vom Standort zum Ziel
  - rotierender Richtungspfeil in Kartenrichtung
  - Distanz + Kurs im Status
- Kartenansicht:
  - klassische 2D Leaflet-Karte ohne Rotationsfunktion
  - Satelliten-BaseLayer mit 60% Opazitaet
  - feste Layerreihenfolge per Pane: Bereiche (hinten), Kranstandorte (mitte), Tische (vorne)

## Effektive Typen aus CSV (wichtig)
- Kein Laufzeit-CSV-Import mehr.
- Quelle/Abgleich bleibt trotzdem:
  - CSV Spalte `Nr.` entspricht GeoJSON `properties.id`
  - CSV Spalte `Typ` wird in GeoJSON `properties.tisch_typ` uebernommen
- Label und Popup verwenden direkt `p.tisch_typ` aus den bereits aktualisierten GeoJSON-Daten.

## Relevante JS-Bausteine in `index.html`
- Navigation:
  - `startFieldNavigation(lat, lng)`
  - `renderNavGuide(fitView)`
  - `haversineMeters(...)`
  - `bearingDegrees(...)`
  - `formatDistance(...)`
  - `navButtonHtml(...)`
- Tischdaten/Labels:
  - `addTableLayer(data, name)`
  - `tableIndex`
  - `buildTableLabel(...)`
  - `buildTablePopupHtml(...)`
  - `addTableTypeVisuals(...)`
  - `tableTypeColor(...)`
  - `tableHatchSide(...)`

## Aenderungsregeln (bitte beibehalten)
- Keine Neuimplementierung mit Frameworks.
- Leaflet-Version beibehalten.
- Eingebettete GeoJSON-Daten in `index.html` nicht loeschen.
- Bestehende Layernamen/Buttons/Funktionen erhalten (ausser explizit gewuenscht).
- Mobile Bedienbarkeit erhalten (Popup-Buttons gut klickbar).
- Suchfunktion fuer Tisch-ID darf nicht regressieren.
- Layer-Steuerung fuer Overlay-Gruppen als Gruppen-Toggle behalten:
  - `Bereiche`, `Modultische`, `Kranstandorte` jeweils gesammelt an/aus.

## Typische Folgeaufgaben
- Neuen CSV-Export einpflegen:
  - einmaliger Abgleich `Nr.` -> `id` und `Typ` -> `tisch_typ`
  - Werte direkt in `pz1Data`, `pz2Data`, `pz2025Data` aktualisieren.
- Popuptexte anpassen:
  - zentral ueber `buildTablePopupHtml(...)`.
- Label-Format aendern:
  - zentral ueber `buildTableLabel(...)`.
- Richtungspfeil-Styling:
  - CSS-Klasse `.nav-dir-arrow`.

## Schnellcheck nach Aenderungen
1. Tisch anklicken -> Popup + `Richtung anzeigen` vorhanden.
2. Kran anklicken -> Popup + `Richtung anzeigen` vorhanden.
3. GPS aktiv + Richtung starten -> Linie/Pfeil/Distanz/Kurs sichtbar.
4. ID-Suche -> zoomt und oeffnet korrektes Popup.
5. Tisch-Label zeigt effektiven Typ aus CSV.

## Git Kurzablauf
```bash
git status
git add index.html export-tableId-2026-05-18.csv CODEX_CONTEXT.md
git commit -m "Update map behavior and docs"
git push origin main
```
