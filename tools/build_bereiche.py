# -*- coding: utf-8 -*-
r"""build_bereiche.py - STRABAG-Bauphasenbereiche (26_4.1, 26_4.2 ...) fuer die Website.

Victor am 31.08.2026: die Bereiche, die sich in Nalpi als Ebene einblenden lassen,
sollen auch auf der Vormontage-Karte zuschaltbar sein.

QUELLE ist dieselbe Datei, die Nalpi als Ebene «Bauphasen_STRABAG_260410» ausliefert:

    MAP_LAYERS Id 2  ->  Shared Documents/Extension/Map/Custom_Layers/
                         Bauphasen_260409_NalpSolar.geojson   (LABEL_PROPERTY = BZCH)

Die lokale Kopie in Panoramakarte_Baustelle\GIS\Quellen\ ist damit byteweise
identisch (SHA-256 am 31.08.2026 gegen SharePoint geprueft) - deshalb wird sie
hier gelesen und nicht der angemeldete Browser bemueht.

Ausgabe: Website_NalpSolar\uploads\bauphasen.json

ACHTUNG Namensnaehe: uploads\tables\bereiche.json ist etwas anderes -
das ist die Zuordnung Tisch -> Bereichsname aus dem Nalpi-Export (gleiche
Spalte Bauphasen_STRABAG_260410), die schrauben.html und verschrauben.html
lesen. Hier geht es um die GEOMETRIE der Bereiche.

    {"stand": "...", "quelle": "...", "bereiche": [
       {"n":"26_4.1", "jb":2026, "js":2026, "t":22, "p":88, "ringe":[[[lat,lon],...],...]}
    ]}

Nur Aussenringe, auf 6 Nachkommastellen gerundet (~0.1 m) - die Ebene ist eine
Orientierungshilfe, kein Absteckplan; damit bleibt die Datei klein genug fuer den
Offline-Cache der Baustellenseite.

Aufruf:
    python tools/build_bereiche.py
    python tools/build_bereiche.py --quelle <pfad.geojson>    andere Revision
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HIER)
PROJEKT = os.path.dirname(WEB)
STANDARD = os.path.join(PROJEKT, 'Panoramakarte_Baustelle', 'GIS', 'Quellen',
                        'Bauphasen_260409_NalpSolar.geojson')
ZIEL = os.path.join(WEB, 'uploads', 'bauphasen.json')


def ringe_aus(geom: dict) -> list:
    """Aussenringe als [[lat, lon], ...] - GeoJSON liefert [lon, lat]."""
    art = geom.get('type')
    if art == 'Polygon':
        roh = [geom['coordinates'][0]] if geom.get('coordinates') else []
    elif art == 'MultiPolygon':
        roh = [p[0] for p in geom.get('coordinates', []) if p]
    else:
        return []
    return [[[round(p[1], 6), round(p[0], 6)] for p in ring] for ring in roh]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--quelle', default=STANDARD)
    a = ap.parse_args()

    if not os.path.exists(a.quelle):
        print('Quelle fehlt: %s' % a.quelle)
        return 1
    with open(a.quelle, encoding='utf-8') as f:
        gj = json.load(f)

    raus = []
    for feat in gj.get('features', []):
        e = feat.get('properties') or {}
        name = e.get('BZCH')
        ringe = ringe_aus(feat.get('geometry') or {})
        if not name or not ringe:
            continue
        raus.append({
            'n': name,
            'jb': e.get('BOHRJAHR'),
            'js': e.get('STAHLJAHR'),
            't': e.get('Tische'),
            'p': e.get('Pfaehle'),
            'ringe': ringe,
        })
    # nach Jahr, dann natuerlich sortiert (4.2 vor 4.10)
    def schluessel(b):
        teile = b['n'].split('_')
        rest = teile[1:] if teile else []
        zahlen = []
        for stueck in rest:
            for x in stueck.split('.'):
                zahlen.append(int(x) if x.isdigit() else 0)
        return (b.get('jb') or 0, teile[0], zahlen, b['n'])
    raus.sort(key=schluessel)

    ausgabe = {
        'stand': 'Bauphasen_STRABAG_260410 (Bauphasenplan 09.04.2026)',
        'quelle': 'Nalpi MAP_LAYERS Id 2, Datei %s' % os.path.basename(a.quelle),
        'bereiche': raus,
    }
    os.makedirs(os.path.dirname(ZIEL), exist_ok=True)
    with open(ZIEL, 'w', encoding='utf-8') as f:
        json.dump(ausgabe, f, ensure_ascii=False, separators=(',', ':'))
    print('%d Bereiche -> %s (%.0f KB)'
          % (len(raus), ZIEL, os.path.getsize(ZIEL) / 1024))
    jahre = {}
    for b in raus:
        jahre[b.get('jb')] = jahre.get(b.get('jb'), 0) + 1
    print('je Bohrjahr: %s' % ', '.join('%s: %d' % (k, v) for k, v in sorted(
        jahre.items(), key=lambda x: (x[0] is None, x[0]))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
