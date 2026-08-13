# tools/ — IFC → 3D-Viewer Konvertierung

Der 3D-Viewer (`viewer3d.html`) lädt **keine** `.ifc` direkt, sondern vorverarbeitete
Binärgeometrie: `<layer>.v.bin` (Positionen), `<layer>.f.bin` (Indizes), optional
`<layer>.e.bin` (Strang-IDs) bzw. `<layer>.c.bin` (Vertex-Farben) und `<layer>.meta.json`.

## Werkleitungen neu erzeugen (PZ1 + PZ2 + PZ3 in einem Layer)

```bash
python tools/build_leitungen.py
```

Liest die ILF-Modelle **direkt aus der Dropbox** (`…\Ausführungspläne\Werkleitungen\FVPZ1|FVPZ2|FVPZ3`,
plus PZ3-HRB aus `uploads/ifc/`) und schreibt `uploads/ifc/leitungen.{v,f,e}.bin` + `.meta.json`.
Die Quellenliste steht oben im Skript unter `QUELLEN` — bei einer neuen Planrevision dort den
Dateinamen anpassen und das Skript erneut laufen lassen.

Ausgabe pro Lauf: Anzahl Stränge je Kategorie (60 / 120 / hrb / schacht) mit Länge.
`meta.straenge[i]` beschreibt jeden Strang (Name, Kategorie, Planungszone, Länge, Anfang/Ende,
Mitte, vereinfachte Achse) — daraus baut der Viewer die Farben, das Klick-Highlight und die
Infobox. Eine eigene `.c.bin` gibt es deshalb nicht mehr.

Die Kategorie kommt aus dem Namen des IfcBuiltElement (`KSR_FV60_VK`/`KSR_60_VK` → 60,
`KSR_120_VK`/`KSR_FV120_VK` → 120, `HRB_VK` → hrb, `Schacht_3D` → schacht). Farben in `CATS`
(Skript) müssen mit der Legende in `viewer3d.html` (`#legend`) übereinstimmen.

`ifc-to-leitungen.js` ist der **abgelöste** Vorgänger (brauchte `npm i web-ifc`); er erzeugte
die alten Layer `werkleitungen` + `leitungen26`, die seit 12.08.2026 nicht mehr geladen werden.

## Wichtig nach dem Regenerieren

1. Wenn sich Dateinamen/Layer ändern: Eintrag im `IFC`-Array und Button in
   `viewer3d.html` anpassen.
2. **`sw.js`**: neue `.bin`/`.meta.json` in `PRECACHE` aufnehmen **und
   `CACHE`-Version hochzählen** (`nalpsolar-vN` → `vN+1`), sonst serviert der
   Service Worker alte Dateien.

## Koordinaten

LV95-Ursprung des Viewers: `OE=2701555, ON=1165641, OZ=1950`.
Gespeichert wird `[East-OE, North-ON, Elev-OZ]`; der Viewer mappt nach Y-up.
Die ILF-IFC (IFC4X3, TriangulatedFaceSet) haben je Datei einen anderen Placement-Ursprung,
aber keine Rotationen — `build_leitungen.py` summiert die IfcLocalPlacement-Kette auf.
