# -*- coding: utf-8 -*-
"""Erzeugt uploads/inventar.json fuer die Pfahlkopf-Inventur (Reiter pfahlkopf.html).

Alles, was die Seite im Feld braucht, wird hier EINMAL vorgerechnet, damit das
Tablet offline nur noch eine Datei laden muss.

Quellen (alle bereits im Repo, kein Dropbox-Zugriff noetig):
  uploads/tables/bohrstand.json   Bohrpunkte: Koordinate LV95 + Status je Pfahl
                                  (IST wenn gebohrt, sonst SOLL) - taeglich 06:30
  uploads/tables/typen.json       Tischtyp je Tisch aus den ILF-Belegungslisten
                                  (NICHT modultische_all.json, siehe Memory
                                  project_tischtyp_202_vollabgleich)
  uploads/tables/baustand.json    je Tisch: Datum Primaerkonstruktion / Modultraeger
  uploads/bauablauf.json          Bereichspolygone (WGS84) fuer die Bereichs-Chips

Ausgabe je Pfahl (kompakt, ein Array):
  [tischId, stuetze 1..4, lat, lon, typBasis, typVoll, bereichIdx, status, kopfSicher]

  status      0 Geplant · 1 Abgesteckt · 2 Gebohrt · 3 Vermessen · 4 Injiziert
  kopfSicher  1 = Primaerkonstruktion steht -> Pfahlkopf ist zwingend montiert
              0 = offen (Kopf kann trotzdem schon drauf sein -> im Feld erfassen)

Aufruf:  python tools/build_inventar.py
"""
import io, json, os, re, collections

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
U    = os.path.join(BASE, 'uploads')
ZIEL = os.path.join(U, 'inventar.json')


def lade(*teile):
    return json.load(io.open(os.path.join(U, *teile), encoding='utf-8'))


def lv95_wgs84(E, N):
    """Naeherungsformel swisstopo (identisch zu tools/build_pfaehle.py)."""
    y = (E - 2600000.0) / 1e6
    x = (N - 1200000.0) / 1e6
    lam = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3
    phi = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x ** 3
    return round(phi * 100 / 36, 6), round(lam * 100 / 36, 6)


def im_polygon(lon, lat, poly):
    """Strahlensatz-Test; poly = [[lon,lat], ...]"""
    drin, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            drin = not drin
        j = i
    return drin


def main():
    bs    = lade('tables', 'bohrstand.json')
    typen = lade('tables', 'typen.json')
    bau   = lade('tables', 'baustand.json')
    try:
        polygone = lade('bauablauf.json').get('polygone', {})
    except (IOError, ValueError):
        polygone = {}

    typ_je_tisch = typen['typen']
    tische_bau   = bau['tische']

    # Bereich je Tisch: erst Polygon, sonst Baujahr aus dem Typ
    namen = sorted(polygone)
    zusatz = ['PZ2025', 'PZ3/2027', u'übrige']
    ber_idx = dict((n, i) for i, n in enumerate(namen + zusatz))

    bereich_cache = {}

    def bereich_von(tid, lat, lon, typ_voll):
        if tid in bereich_cache:
            return bereich_cache[tid]
        treffer = None
        for name in namen:
            if im_polygon(lon, lat, polygone[name]):
                treffer = name
                break
        if treffer is None:
            if typ_voll.endswith('_2025'):
                treffer = 'PZ2025'
            elif typ_voll.endswith('_2027'):
                treffer = 'PZ3/2027'
            else:
                treffer = u'übrige'
        bereich_cache[tid] = treffer
        return treffer

    raus, ohne_typ = [], set()
    for p in bs['punkte']:
        tid, stz, E, N, H, status, _nb = p[0], p[1], p[2], p[3], p[4], p[5], p[6]
        tid = str(tid)
        typ_voll = typ_je_tisch.get(tid, '')
        if not typ_voll:
            ohne_typ.add(tid)
        typ_basis = (re.match(r'([A-Z]+)', typ_voll).group(1) if typ_voll else '?')
        lat, lon = lv95_wgs84(E, N)
        b = bau.get(tid) if isinstance(bau, dict) and tid in bau else tische_bau.get(tid)
        kopf_sicher = 1 if (b or {}).get('pk') else 0
        raus.append([tid, stz, lat, lon, typ_basis, typ_voll,
                     ber_idx[bereich_von(tid, lat, lon, typ_voll)], status, kopf_sicher])

    raus.sort(key=lambda r: (int(r[0]) if r[0].isdigit() else 0, r[1]))

    daten = {
        'stand': {
            'bohr':  bs.get('stand', ''),
            'bau':   bau.get('stand', ''),
            'typen': typen.get('stand', ''),
        },
        'bereiche': namen + zusatz,
        'legende': bs.get('legende', []),
        'pfaehle': raus,
    }

    with io.open(ZIEL, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{"stand":%s,\n' % json.dumps(daten['stand'], ensure_ascii=False))
        f.write('"bereiche":%s,\n' % json.dumps(daten['bereiche'], ensure_ascii=False))
        f.write('"legende":%s,\n'  % json.dumps(daten['legende'], ensure_ascii=False))
        f.write('"pfaehle":[\n')
        f.write(',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in raus))
        f.write('\n]}\n')

    # ---- Kontrollausgabe -------------------------------------------------
    offen = [r for r in raus if not r[8] and r[7] >= 2]   # im Boden, PK steht noch nicht
    je_typ = collections.Counter(r[4] for r in offen)
    print('-> %s' % ZIEL)
    print('   %d Bohrpunkte gesamt, Stand Bohren %s / Bau %s / Typen %s'
          % (len(raus), daten['stand']['bohr'], daten['stand']['bau'], daten['stand']['typen']))
    print('   im Boden und ohne Primaerkonstruktion (= Kopf offen): %d Pfaehle' % len(offen))
    for t in sorted(je_typ):
        print('      Typ %-2s %4d' % (t, je_typ[t]))
    print('      Muffe klein (A/B, ROR 88.9): %d   Muffe gross (C/D/E, ROR 114): %d'
          % (sum(je_typ[t] for t in 'AB'), sum(je_typ[t] for t in 'CDE')))
    if ohne_typ:
        print('   ! ohne Typangabe: %d Tische (z.B. %s)'
              % (len(ohne_typ), ', '.join(sorted(ohne_typ)[:8])))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
