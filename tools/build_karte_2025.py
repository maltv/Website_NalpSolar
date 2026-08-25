# -*- coding: utf-8 -*-
"""Traegt die Modultische der Serie 2025 (letztes Jahr gestellt) in die 2D-Karte ein.

Quelle: uploads/tables/modultische_all.json  – kommt taeglich 06:30 direkt aus
Nalpi (Tools/Nalpi_Stand_Abholen.py). Genommen werden alle Tische, deren Typ
auf _2025 endet und die in karte.html noch in keinem der bestehenden
Datensaetze (pz1Data / pz2Data / pz2025Data / pz3Data) stehen.

Achse wie bei den bestehenden Tischen: Zentrum LV95, Richtung tisch_ausrichtung
+ 90 Grad, halbe tisch_laenge nach beiden Seiten, umgerechnet mit derselben
Naeherungsformel wie karte.html (ch1903PlusToWgs84).
Gegenprobe an den 824 schon eingetragenen Tischen: groesste Abweichung 1 mm.

Wiederholbar: der Datenblock wird bei jedem Lauf ersetzt, Layer und
Ebenenschalter werden nur eingefuegt, wenn sie noch fehlen.
Aufruf:  python tools/build_karte_2025.py  [--trocken]
"""
import io, json, math, os, re, shutil, sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KARTE = os.path.join(WEB, "karte.html")
QUELLE = os.path.join(WEB, "uploads", "tables", "modultische_all.json")
SICHERUNG = os.path.join(WEB, "_Archiv", "karte_vor_serie2025.html")   # nur ohne git

VAR = "bestand2025Data"
LAYER = "bestand2025Layer"
POPUP_NAME = "2025"                 # steht im Popup vor der Tisch-ID
EBENE_NAME = "Modultische 2025"     # Beschriftung im Ebenenschalter

TROCKEN = "--trocken" in sys.argv


def ch1903plus_zu_wgs84(north, east):
    """1:1 dieselbe Formel wie ch1903PlusToWgs84() in karte.html."""
    x = (north - 1200000.0) / 1000000.0
    y = (east - 2600000.0) / 1000000.0
    lat = (16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x
           - 0.0447 * y * y * x - 0.0140 * x * x * x)
    lng = (2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x
           - 0.0436 * y * y * y)
    return [lng * 100.0 / 36.0, lat * 100.0 / 36.0]   # GeoJSON: [lon, lat]


def achse(east, north, azimut, laenge):
    a = math.radians(azimut + 90.0)
    de = math.sin(a) * laenge / 2.0
    dn = math.cos(a) * laenge / 2.0
    return [ch1903plus_zu_wgs84(north - dn, east - de),
            ch1903plus_zu_wgs84(north + dn, east + de)]


def vorhandene_ids(src):
    ids = set()
    for name in ("pz1Data", "pz2Data", "pz2025Data", "pz3Data"):
        m = re.search(r"const " + name + r" = (\{.*?\});?\n", src, re.S)
        if not m:
            raise SystemExit("Datensatz %s nicht gefunden - karte.html geprueft?" % name)
        for f in json.loads(m.group(1)).get("features", []):
            ids.add(str(f.get("properties", {}).get("id", "")).strip())
    return ids


def main():
    src = io.open(KARTE, encoding="utf-8").read()
    tische = json.load(io.open(QUELLE, encoding="utf-8"))
    stand = __import__("datetime").date.fromtimestamp(os.path.getmtime(QUELLE)).isoformat()

    schon = vorhandene_ids(src)
    features = []
    for r in tische:
        tid, e, n, hoehe, az, laenge, typ, modul_h = r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]
        if not str(typ).upper().endswith("_2025"):
            continue
        if str(tid).strip() in schon:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "id": int(tid) if str(tid).isdigit() else tid,
                "zentrum_rechts": e, "zentrum_hoch": n,
                "zentrum_hoehe": hoehe, "modul_hoehe": modul_h,
                "tisch_typ": typ, "tisch_ausrichtung": az, "tisch_laenge": laenge,
                "quelle": "Nalpi modultische_all.json, Stand " + stand,
            },
            "geometry": {"type": "LineString", "coordinates": achse(e, n, az, laenge)},
        })
    features.sort(key=lambda f: (str(f["properties"]["id"]).zfill(8)))
    print("Serie 2025 ohne Eintrag in der Karte: %d Tische" % len(features))
    if not features:
        print("nichts einzutragen - Karte ist aktuell")
        return

    fc = {"type": "FeatureCollection", "name": "Modultische_Serie_2025", "features": features}
    block = "const %s = %s;\n" % (VAR, json.dumps(fc, ensure_ascii=False, separators=(",", ":")))

    zeilen = src.split("\n")
    idx = [i for i, z in enumerate(zeilen) if z.startswith("const %s = " % VAR)]
    if idx:                                    # Datenblock schon da -> ersetzen
        zeilen[idx[0]] = block.rstrip("\n")
        src = "\n".join(zeilen)
        print("Datenblock ersetzt (Zeile %d)" % (idx[0] + 1))
    else:                                      # erster Lauf -> alles einhaengen
        anker = "\nconst pz1Layer = addTableLayer(pz1Data, 'PZ1');"
        if anker not in src:
            raise SystemExit("Ankerzeile pz1Layer nicht gefunden")
        src = src.replace(anker, "\n" + block + anker, 1)
        print("Datenblock neu eingefuegt")

    layerzeile = "const %s = addTableLayer(%s, '%s');\n" % (LAYER, VAR, POPUP_NAME)
    if LAYER not in src.replace(block, ""):
        anker = "const pz3Layer = addTableLayer(pz3Data, 'PZ3');\n"
        src = src.replace(anker, anker + layerzeile, 1)
        print("Layer eingehaengt")

    ctrl = "      { name: '%s', layer: %s },\n" % (EBENE_NAME, LAYER)
    if ctrl not in src:
        anker = "      { name: 'PZ3 Modultische (2027)', layer: pz3Layer },\n"
        if anker not in src:
            raise SystemExit("Ankerzeile im Ebenenschalter nicht gefunden")
        src = src.replace(anker, anker + ctrl, 1)
        print("Ebenenschalter ergaenzt: %s" % EBENE_NAME)

    zaehl_alt = ("pz2025Data.features.length + pz3Data.features.length) + ' Modultische, '")
    zaehl_neu = ("pz2025Data.features.length + pz3Data.features.length + "
                 "%s.features.length) + ' Modultische, '" % VAR)
    if zaehl_alt in src:
        src = src.replace(zaehl_alt, zaehl_neu, 1)
        print("Statuszeile 'Geladen: ... Modultische' mitgezaehlt")

    if TROCKEN:
        print("--trocken: karte.html NICHT geschrieben")
        return
    # Rollback: im Repo macht das git (git checkout -- karte.html). Eine Kopie im
    # Web-Ordner waere 6,6 MB, die beim naechsten Deploy mit hochgingen - darum nur,
    # wenn hier kein git liegt.
    if not os.path.isdir(os.path.join(WEB, ".git")):
        if not os.path.exists(SICHERUNG):
            os.makedirs(os.path.dirname(SICHERUNG), exist_ok=True)
            shutil.copy2(KARTE, SICHERUNG)
            print("Sicherung angelegt:", os.path.relpath(SICHERUNG, WEB))
    else:
        print("Rollback ueber git:  git checkout -- karte.html")
    io.open(KARTE, "w", encoding="utf-8", newline="").write(src)
    print("karte.html geschrieben (%.1f MB)" % (os.path.getsize(KARTE) / 1048576.0))


main()
