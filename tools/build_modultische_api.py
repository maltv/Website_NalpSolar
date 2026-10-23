# -*- coding: utf-8 -*-
r"""build_modultische_api.py - uploads/tables/modultische_all.json aus dem Buildtrack-API.

Ersetzt seit 23.10.2026 das Lesen der ILF-Belegung-Excels aus der Dropbox (tools/build_baustand.py):
die Query-Engine GET /api/w1/q/tables liefert fuer JEDEN Tisch (23.10.2026: 1277, davon 229 neue in
Bereich 9 / BP C+D, die in keiner lokalen ILF-Liste standen) Zentrum, Ausrichtung, Modulzahl, Typ,
die SOLL-Hoehe UK Modul und die vier SOLL-Pfahlpunkte S1-S4 mit Hoehe.

Zeile je Tisch (Felder 0-7 unveraendert wie bisher, Feld 8 NEU):
    [id, E, N, Z, az, len, typ, mh, [[e,n,h] S1, [e,n,h] S2, [e,n,h] S3, [e,n,h] S4]]
    Z   = center_h (ILF zentrum_hoehe)
    az  = Blickrichtung der Module (Azimut, 0 = Nord, im Uhrzeigersinn) - hergeleitet aus den
          Pfaehlen: Mitte Bergpfaehle (S2/S3) -> Mitte Talpfaehle (S1/S4). An allen 1048 bisherigen
          Tischen identisch mit der ILF-Spalte tisch_ausrichtung (Abgleich 23.10.2026, 0 Abweichungen
          > 0.5 Grad). orientation_alpha des API waere mehrdeutig (941x az-180, 55x az).
    len = 12.394 m bei 10 Modulen, 10.007 m bei 8 Modulen (Abgleich 23.10.2026: 1011 + 37 Tische)
    typ = Typbuchstabe + '_' + Baujahr, z. B. 'B_2026' (wie bisher; Vollcode steht im API
          als geometry_code, z. B. B_KF2025)
    mh  = h_soll = SOLL UK Modul am Auflagerkopf. BELEG: Nalpi-Formel PS_Tal = (h_soll - IST_H)*1000
          - ABZ(Typ) trifft 1597 von 1618 freigegebenen Tal-Passstuecken auf < 5 mm - auch bei der
          Serie 2025, wo h_soll nur 0.2-0.9 m ueber center_h liegt (NICHT +4.2 wie bei 2026/2027).
    S1/S4 = Talpfaehle (lotrecht), S2/S3 = Bergpfaehle (geneigt); ILF-Zentrum = Mitte S1-S4.

TOKEN wie tools/nalpi_stand_api.py: NALPS_API_TOKEN oder NALPS_API_TOKEN_FILE. Braucht plan:read.

Aufruf (aus Website_NalpSolar):
    python tools/build_modultische_api.py [--basis https://...]
Schreibt nichts, wenn das API weniger als 90 % der bisherigen Tische liefert.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nalpi_stand_api import BASIS, token_lesen  # noqa: E402

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(BASE, 'uploads', 'tables', 'modultische_all.json')

SPALTEN = ('table_key,geometry_code,year,module_amount,h_soll,center_e,center_n,center_h,'
           's1_e,s1_n,s1_h,s2_e,s2_n,s2_h,s3_e,s3_n,s3_h,s4_e,s4_n,s4_h,withdrawn_on')
LAENGE = {8: 10.007, 10: 12.394}
SEITE = 5000


def abfragen(basis: str, token: str) -> list[dict]:
    """GET /api/w1/q/tables, blaettert mit limit/offset bis zur leeren Seite."""
    alle: list[dict] = []
    offset = 0
    while True:
        q = urllib.parse.urlencode({'select': SPALTEN, 'order': 'table_key', 'limit': SEITE, 'offset': offset})
        req = urllib.request.Request(basis + '/api/w1/q/tables?' + q, headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json',
            'User-Agent': 'Website_NalpSolar build_modultische_api.py',
        })
        for versuch in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as antwort:
                    seite = json.loads(antwort.read().decode('utf-8'))
                break
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    sys.exit('FEHLER %d: Token fehlt/abgelaufen oder ohne plan:read.' % e.code)
                if e.code == 429 and versuch < 2:
                    time.sleep(int(e.headers.get('Retry-After') or 60))
                    continue
                if e.code == 503 and versuch < 2:
                    time.sleep(5)
                    continue
                sys.exit('FEHLER %d bei /api/w1/q/tables' % e.code)
            except urllib.error.URLError as e:
                sys.exit('FEHLER: %s nicht erreichbar (%s)' % (basis, e.reason))
        if not isinstance(seite, list):
            sys.exit('FEHLER: /api/w1/q/tables antwortet nicht mit einer Liste.')
        alle.extend(seite)
        if len(seite) < SEITE:
            return alle
        offset += SEITE


def azimut(r: dict) -> float:
    """Blickrichtung der Module: Mitte Bergpfaehle (S2/S3) -> Mitte Talpfaehle (S1/S4)."""
    be = (r['s2_e'] + r['s3_e']) / 2.0
    bn = (r['s2_n'] + r['s3_n']) / 2.0
    te = (r['s1_e'] + r['s4_e']) / 2.0
    tn = (r['s1_n'] + r['s4_n']) / 2.0
    return math.degrees(math.atan2(te - be, tn - bn)) % 360.0


def zeile(r: dict) -> list | None:
    noetig = ('center_e', 'center_n', 'center_h', 'h_soll',
              's1_e', 's1_n', 's1_h', 's2_e', 's2_n', 's2_h',
              's3_e', 's3_n', 's3_h', 's4_e', 's4_n', 's4_h')
    if any(r.get(k) is None for k in noetig):
        return None
    code = str(r.get('geometry_code') or '')
    typ = (code[:1].upper() + '_' + str(r.get('year') or '')) if code else ''
    laenge = LAENGE.get(r.get('module_amount'))
    if laenge is None:
        print('  ! Tisch %s: %s Module - Laenge 12.394 angenommen' % (r['table_key'], r.get('module_amount')))
        laenge = 12.394
    pf = [[round(r['s%d_e' % i], 3), round(r['s%d_n' % i], 3), round(r['s%d_h' % i], 3)] for i in (1, 2, 3, 4)]
    return [str(r['table_key']).strip(),
            round(r['center_e'], 3), round(r['center_n'], 3), round(r['center_h'], 3),
            round(azimut(r), 2), laenge, typ, round(r['h_soll'], 3), pf]


def sortschluessel(t: list) -> tuple:
    s = t[0]
    return (0, int(s)) if s.isdigit() else (1, s)


def main() -> int:
    ap = argparse.ArgumentParser(description='modultische_all.json aus dem Buildtrack-API bauen.')
    ap.add_argument('--basis', default=BASIS)
    a = ap.parse_args()

    alt: dict[str, list] = {}
    if os.path.exists(ZIEL):
        try:
            alt = {str(t[0]).strip(): t for t in json.load(io.open(ZIEL, encoding='utf-8'))}
        except ValueError:
            alt = {}

    rohe = abfragen(a.basis.rstrip('/'), token_lesen())
    neu: dict[str, list] = {}
    fehlend, zurueckgezogen = [], []
    for r in rohe:
        if r.get('withdrawn_on'):
            zurueckgezogen.append(str(r['table_key']))
            continue
        z = zeile(r)
        if z is None:
            fehlend.append(str(r['table_key']))
            continue
        neu[z[0]] = z
    if fehlend:
        print('  ! %d Tische ohne vollstaendige Geometrie im API (bleiben weg): %s'
              % (len(fehlend), ','.join(fehlend[:30])))
    if zurueckgezogen:
        print('  zurueckgezogen (withdrawn_on): %d -> %s' % (len(zurueckgezogen), ','.join(zurueckgezogen[:30])))
    if alt and len(neu) < 0.9 * len(alt):
        sys.exit('FEHLER: API liefert nur %d Tische (bisher %d) - modultische_all.json bleibt.' % (len(neu), len(alt)))

    dazu = sorted(set(neu) - set(alt), key=lambda s: (0, int(s)) if s.isdigit() else (1, s))
    weg = sorted(set(alt) - set(neu), key=lambda s: (0, int(s)) if s.isdigit() else (1, s))
    vals = sorted(neu.values(), key=sortschluessel)
    with io.open(ZIEL, 'w', encoding='utf-8', newline='\n') as f:
        f.write('[\n' + ',\n'.join(json.dumps(v, ensure_ascii=False) for v in vals) + '\n]\n')
    jahre: dict[str, int] = {}
    for v in vals:
        j = v[6].split('_')[-1] if v[6] else '?'
        jahre[j] = jahre.get(j, 0) + 1
    print('  modultische_all.json: %d Tische aus dem API (%s)%s%s' % (
        len(vals), ', '.join('%s: %d' % (k, jahre[k]) for k in sorted(jahre)),
        ('; neu %d: %s%s' % (len(dazu), ','.join(dazu[:25]), ' ...' if len(dazu) > 25 else '')) if dazu else '',
        ('; weggefallen %d: %s' % (len(weg), ','.join(weg[:25]))) if weg else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
