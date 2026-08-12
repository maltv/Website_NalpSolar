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
import os, re, sys, csv, json, glob, math, warnings
warnings.filterwarnings('ignore')
from PIL import Image
from pyproj import Transformer

WEB   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ  = os.path.dirname(WEB)
ERD   = os.path.join(PROJ, 'Erdungsdokumentation')
ZIEL  = os.path.join(WEB, 'uploads', 'erdung')
ZFOTO = os.path.join(ZIEL, 'fotos')
sys.path.insert(0, os.path.join(ERD, 'Tools'))
from erdleiter import (ROHDATEN, doku_lesen, rohdaten_lesen, abstand,   # noqa: E402
                       survey123_fotos)
from doku_bauen import datum_aus_dateiname                            # noqa: E402

LV95_NACH_WGS84 = Transformer.from_crs('EPSG:2056', 'EPSG:4326', always_xy=True)
BREITE_FOTO = 900


def nach_wgs84(ost, nord):
    lon, lat = LV95_NACH_WGS84.transform(ost, nord)
    return round(lat, 7), round(lon, 7)


# ------------------------------------------------------- Werkleitungen (IFC) --
# Der 3D-Viewer haelt die Leitungen im Frame [Ost-OE, Nord-ON, Hoehe-OZ].
OE, ON, OZ = 2701555, 1165641, 1950


def leitungen_lesen():
    """Achsen der 284 Leitungsstraenge aus uploads/ifc/leitungen.meta.json.
    Gebaut von tools/build_leitungen.py aus den ILF-Werkleitungsmodellen."""
    pfad = os.path.join(WEB, 'uploads', 'ifc', 'leitungen.meta.json')
    if not os.path.exists(pfad):
        return [], []
    meta = json.load(open(pfad, encoding='utf-8'))
    zuege = []
    for s in meta['straenge']:
        achse = s.get('p') or []
        if len(achse) < 2:
            continue
        zuege.append(dict(
            n=s.get('n', ''), k=s.get('k', ''), q=s.get('q', ''),
            l=round(s.get('l', 0), 1),
            pp=[list(nach_wgs84(p[0] + OE, p[1] + ON)) for p in achse]))
    return zuege, meta.get('legend', [])


# --------------------------------------------------- Erdungsband PZ1 (IFC) ----
def step_lesen(pfad):
    """Minimaler STEP-Leser: #id -> (Typ, Argumentstring). erdung.ifc ist IFC4
    mit klassischem BREP (IFCFACE/IFCPOLYLOOP), nicht IFC4X3 wie die WL-Modelle,
    deshalb reicht der Parser aus build_leitungen.py hier nicht."""
    roh = open(pfad, encoding='utf-8', errors='replace').read()
    roh = roh[roh.find('DATA;'):]
    ents = {}
    for m in re.finditer(r'#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(', roh):
        start = m.end()
        tiefe, i = 1, start
        while i < len(roh) and tiefe:
            c = roh[i]
            if c == "'":
                i = roh.find("'", i + 1)
            elif c == '(':
                tiefe += 1
            elif c == ')':
                tiefe -= 1
            i += 1
        ents[int(m.group(1))] = (m.group(2), roh[start:i - 1])
    return ents


def refs(text):
    return [int(x) for x in re.findall(r'#(\d+)', text)]


def erdung_lesen():
    """Erdungsband + Oberflaechenerder aus dem PZ1-Modell (M_0463_A1).
    Koordinaten stehen dort absolut in LV95. Achse je Element ueber die
    Hauptrichtung der Punktwolke - die Baender sind lang und duenn."""
    pfad = os.path.join(WEB, 'uploads', 'ifc', 'erdung.ifc')
    if not os.path.exists(pfad):
        return []
    ents = step_lesen(pfad)
    punkte = {i: [float(x) for x in re.findall(r'-?\d+\.?\d*(?:E[-+]?\d+)?', a)][:3]
              for i, (t, a) in ents.items() if t == 'IFCCARTESIANPOINT'}

    def sammeln(eid, tiefe=0, gesehen=None):
        """rekursiv alle CartesianPoints unterhalb eines Knotens"""
        gesehen = gesehen if gesehen is not None else set()
        if eid in gesehen or tiefe > 9 or eid not in ents:
            return []
        gesehen.add(eid)
        if ents[eid][0] == 'IFCCARTESIANPOINT':
            return [punkte[eid]] if eid in punkte else []
        out = []
        for r in refs(ents[eid][1]):
            out += sammeln(r, tiefe + 1, gesehen)
        return out

    stuecke = []
    for eid, (typ, args) in ents.items():
        if typ != 'IFCBUILDINGELEMENTPROXY':
            continue
        teile = split_top(args)
        name = (teile[2].strip().strip("'") if len(teile) > 2 else '') or 'Erdung'
        pts = [p for p in sammeln(eid) if len(p) == 3 and p[0] > 2_000_000]
        if len(pts) < 6:
            continue
        achse = hauptachse(pts)
        if len(achse) < 2:
            continue
        laenge = sum(math.dist(achse[i], achse[i + 1]) for i in range(len(achse) - 1))
        stuecke.append(dict(n=name, l=round(laenge, 1),
                            art='band' if laenge > 6 else 'erder',
                            pp=[list(nach_wgs84(p[0], p[1])) for p in achse]))
    return stuecke


def split_top(s):
    """Argumente einer STEP-Zeile auf oberster Klammerebene trennen."""
    teile, tiefe, akt, i = [], 0, '', 0
    while i < len(s):
        c = s[i]
        if c == "'":
            j = s.find("'", i + 1)
            akt += s[i:j + 1]
            i = j + 1
            continue
        if c == '(':
            tiefe += 1
        elif c == ')':
            tiefe -= 1
        if c == ',' and tiefe == 0:
            teile.append(akt)
            akt = ''
        else:
            akt += c
        i += 1
    teile.append(akt)
    return teile


def hauptachse(pts, bin_m=2.0):
    """Punktwolke eines Bandes -> Mittellinie: auf die Hauptrichtung projizieren,
    in Abschnitte von bin_m schneiden, je Abschnitt den Schwerpunkt nehmen."""
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    winkel = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(winkel), math.sin(winkel)
    eimer = {}
    for p in pts:
        t = (p[0] - mx) * ux + (p[1] - my) * uy
        k = int(t // bin_m)
        e = eimer.setdefault(k, [0, 0, 0, 0])
        e[0] += p[0]; e[1] += p[1]; e[2] += p[2]; e[3] += 1
    return [[e[0] / e[3], e[1] / e[3], e[2] / e[3]]
            for _, e in sorted(eimer.items())]


def fotos_verkleinern(namen):
    """Bilder auf 900 px bringen. Quelle ist entweder der WhatsApp-Ordner
    Fotos_2026\\ oder der Survey123-Ordner Fotos_Survey123\\."""
    os.makedirs(ZFOTO, exist_ok=True)
    gebaut = 0
    for name in namen:
        quelle = os.path.join(ERD, 'Fotos_2026', name)
        if not os.path.exists(quelle):
            quelle = os.path.join(ERD, 'Fotos_Survey123', name)
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

    s123 = survey123_fotos()
    for nr, dateien in s123.items():
        je_punkt.setdefault(nr, [])
        for d in dateien:
            if d not in je_punkt[nr]:
                je_punkt[nr].append(d)
        foto_meta.setdefault(d, dict(d='', b='aus Survey123'))

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

    leitungen, leg = leitungen_lesen()
    erdung = erdung_lesen()

    daten = dict(
        stand='12.08.2026',
        punkte=punkte,
        fotos=foto_meta,
        nur_foto=nur_foto,
        leitungen=leitungen,
        leitungen_legende=leg,
        erdung_soll=erdung,
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
            leitungen='ILF-Werkleitungsmodelle PZ1/PZ2/PZ3 (M_0460_A2, M_0468_A2, M_0465_A1, '
                      'M_0472_A1, M_0475_A1) ueber tools\\build_leitungen.py',
            erdungsoll='PZ1-Erdungsmodell M_0463_A1 (uploads\\ifc\\erdung.ifc). Fuer PZ2 und PZ3 '
                       'gibt es KEIN Modell - ILF am 29.07.2026: "Ein 3D-Modell der Erdung ist '
                       'nicht geplant, ... da es hinsichtlich Abnahme einen 2D-Plan braucht."',
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
    print('  Leitungsstraenge     : %d (%.0f m)'
          % (len(leitungen), sum(s['l'] for s in leitungen)))
    print('  Erdung PZ1 aus Plan  : %d Baender (%.0f m) + %d Oberflaechenerder'
          % (sum(1 for s in erdung if s['art'] == 'band'),
             sum(s['l'] for s in erdung if s['art'] == 'band'),
             sum(1 for s in erdung if s['art'] == 'erder')))


if __name__ == '__main__':
    main()
