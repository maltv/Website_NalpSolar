# -*- coding: utf-8 -*-
r"""
Baut die Datengrundlage fuer erdung.html (Admin-Reiter).

Liest:
  Dropbox (READ ONLY) ...\04 Pruefungen\Erdleiter\251027_Dokumentation Erdleiter.xlsx
  Dropbox (READ ONLY) ...\04 Pruefungen\Erdleiter\Rohdaten\*.txt|csv   (2026)
  Arbeitskopie        Erdungsdokumentation\foto_zuordnung_2026.csv
  Arbeitskopie        Erdungsdokumentation\Fotos_2026\*.jpg

Schreibt:
  uploads\erdung\erdungspunkte.json    Punkte + Zuordnung + Kennzahlen
  uploads\erdung\fotos\*.jpg           dieselben Bilder auf 900 px verkleinert

Aufruf (aus Website_NalpSolar):  python tools\build_erdung_karte.py
Nach jedem neuen Vermessungs- oder Fotostand neu laufen lassen und pushen.
"""
import os, sys, csv, json, glob, math, warnings
warnings.filterwarnings('ignore')
from PIL import Image
from pyproj import Transformer

WEB   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ  = os.path.dirname(WEB)
ERD   = os.path.join(PROJ, 'Erdungsdokumentation')
ZIEL  = os.path.join(WEB, 'uploads', 'erdung')
ZFOTO = os.path.join(ZIEL, 'fotos')
sys.path.insert(0, os.path.join(ERD, 'Tools'))
from erdleiter import ROHDATEN, doku_lesen, rohdaten_lesen, abstand   # noqa: E402
from doku_bauen import datum_aus_dateiname                            # noqa: E402

LV95_NACH_WGS84 = Transformer.from_crs('EPSG:2056', 'EPSG:4326', always_xy=True)
BREITE_FOTO = 900


def nach_wgs84(ost, nord):
    lon, lat = LV95_NACH_WGS84.transform(ost, nord)
    return round(lat, 7), round(lon, 7)


def fotos_verkleinern(namen):
    os.makedirs(ZFOTO, exist_ok=True)
    gebaut = 0
    for name in namen:
        quelle = os.path.join(ERD, 'Fotos_2026', name)
        ziel = os.path.join(ZFOTO, name)
        if not os.path.exists(quelle) or os.path.exists(ziel):
            continue
        bild = Image.open(quelle)
        bild.thumbnail((BREITE_FOTO, BREITE_FOTO), Image.LANCZOS)
        bild.convert('RGB').save(ziel, 'JPEG', quality=78, optimize=True)
        gebaut += 1
    return gebaut


def main():
    doku25 = doku_lesen()
    roh26, _ = rohdaten_lesen(ROHDATEN)

    je_punkt = {}
    foto_meta = {}
    with open(os.path.join(ERD, 'foto_zuordnung_2026.csv'), encoding='utf-8') as fh:
        for satz in csv.DictReader(fh, delimiter=';'):
            foto_meta[satz['Dateiname']] = dict(d=satz['Aufnahmedatum'],
                                                b=satz['Bemerkung aus Bild'])
            for p in [x.strip() for x in (satz['Punktnummern'] or '').split(',') if x.strip()]:
                je_punkt.setdefault(p, []).append(satz['Dateiname'])

    kollisionen = {nr for nr in roh26
                   if nr in doku25 and abstand(roh26[nr], doku25[nr]) > 0.10}

    punkte = []
    for nr, p in doku25.items():
        lat, lon = nach_wgs84(p['E'], p['N'])
        punkte.append(dict(s='25-%s' % nr, nr=nr, j=2025, lat=lat, lon=lon,
                           e=round(p['E'], 3), n=round(p['N'], 3), z=round(p['H'], 3),
                           st=p['strang'], ab=p['abschnitt'],
                           q='Dokumentation 27.10.2025',
                           f=p['fotos'], fj=2025,
                           k='ok' if p['fotos'] else 'ohne_foto'))

    for nr in sorted(roh26, key=int):
        p = roh26[nr]
        lat, lon = nach_wgs84(p['E'], p['N'])
        datum = datum_aus_dateiname(p['quelle'])
        dateien = je_punkt.get(nr, [])
        punkte.append(dict(s='26-%s' % nr, nr=nr, j=2026, lat=lat, lon=lon,
                           e=round(p['E'], 3), n=round(p['N'], 3), z=round(p['H'], 3),
                           st='', ab='',
                           q='%s%s' % (p['quelle'],
                                       ' · %s' % datum.strftime('%d.%m.%Y') if datum else ''),
                           f=dateien, fj=2026,
                           k='ok' if dateien else 'ohne_foto',
                           koll=nr in kollisionen))

    # Punkte, die nur auf Fotos vorkommen - ohne Koordinaten, deshalb nicht auf der Karte
    nur_foto = sorted((p for p in je_punkt if p not in roh26), key=int)

    os.makedirs(ZIEL, exist_ok=True)
    alle_fotos = sorted({f for liste in je_punkt.values() for f in liste})
    gebaut = fotos_verkleinern(alle_fotos)

    daten = dict(
        stand='12.08.2026',
        punkte=punkte,
        fotos=foto_meta,
        nur_foto=nur_foto,
        kennzahlen=dict(
            gesamt=len(punkte),
            p2025=len(doku25), p2026=len(roh26),
            ohne_foto=sum(1 for p in punkte if p['k'] == 'ohne_foto'),
            ohne_vermessung=len(nur_foto),
            kollisionen=sorted(kollisionen, key=int),
        ),
        quellen=dict(
            doku2025='Dropbox 04 Pruefungen\\Erdleiter\\251027_Dokumentation Erdleiter.xlsx',
            roh2026='Dropbox 04 Pruefungen\\Erdleiter\\Rohdaten\\ (12 Dateien 12.06.-31.07.2026)',
            fotos2026='Google Drive "Erdungsdok", uebernommen 12.08.2026; Punktnummer aus der '
                      'Beschriftung im Bild ausgelesen',
        ))
    pfad = os.path.join(ZIEL, 'erdungspunkte.json')
    with open(pfad, 'w', encoding='utf-8') as fh:
        json.dump(daten, fh, ensure_ascii=False, separators=(',', ':'))

    mb = sum(os.path.getsize(f) for f in glob.glob(os.path.join(ZFOTO, '*.jpg'))) / 1e6
    print('%s  (%.0f KB)' % (pfad, os.path.getsize(pfad) / 1e3))
    print('  Punkte auf der Karte : %d  (2025: %d / 2026: %d)'
          % (len(punkte), len(doku25), len(roh26)))
    print('  ohne Foto            : %d' % daten['kennzahlen']['ohne_foto'])
    print('  ohne Vermessung      : %d (nicht kartierbar)' % len(nur_foto))
    print('  Fotos                : %d neu verkleinert, %.1f MB gesamt' % (gebaut, mb))


if __name__ == '__main__':
    main()
