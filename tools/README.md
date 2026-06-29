# tools/ — IFC → 3D-Viewer Konvertierung

Der 3D-Viewer (`viewer3d.html`) lädt **keine** `.ifc` direkt, sondern vorverarbeitete
Binärgeometrie: `<layer>.v.bin` (Positionen), `<layer>.f.bin` (Indizes), optional
`<layer>.c.bin` (Vertex-Farben) und `<layer>.meta.json`.

## Neue Leitungs-IFC (60/120/HRB/Schacht) neu erzeugen

```bash
npm i web-ifc                 # einmalig (nicht eingecheckt)
node tools/ifc-to-leitungen.js
```

Default: liest die drei PZ2/PZ3-Files in `uploads/ifc/` und schreibt
`uploads/ifc/leitungen26.{v,f,c}.bin` + `.meta.json`.

Eigene Files / anderes Ziel:

```bash
node tools/ifc-to-leitungen.js uploads/ifc/meinlayer datei1.ifc datei2.ifc
```

Die Kategorie (Farbe) wird aus dem IfcBuiltElement-Namen abgeleitet
(`KSR_FV60_VK`/`KSR_60_VK` → 60, `KSR_120_VK` → 120, `HRB_VK` → hrb,
`Schacht_3D` → schacht). Farben in `CATS` (Script) müssen mit der Legende
in `viewer3d.html` (`#legend`) übereinstimmen.

## Wichtig nach dem Regenerieren

1. Wenn sich Dateinamen/Layer ändern: Eintrag im `IFC`-Array und Button in
   `viewer3d.html` anpassen.
2. **`sw.js`**: neue `.bin`/`.meta.json` in `PRECACHE` aufnehmen **und
   `CACHE`-Version hochzählen** (`nalpsolar-vN` → `vN+1`), sonst serviert der
   Service Worker alte Dateien.

## Koordinaten

LV95-Ursprung des Viewers: `OE=2701555, ON=1165641, OZ=1950`.
Gespeichert wird `[East-OE, North-ON, Elev-OZ]`; der Viewer mappt nach Y-up.
Transform validiert gegen die bestehende `werkleitungen.ifc`.
