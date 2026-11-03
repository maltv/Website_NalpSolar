# -*- coding: utf-8 -*-
r"""build_ps_tal.py - uploads/tables/ps_tal.json fuer ps-tal.html (Passstueck-Check im Tal-Lager).

Die Seite scannt ein Mauchle-Etikett «Position <Tisch>-<Stuetze>-<Laenge>» und sagt sofort, ob das Stueck
noch gebraucht wird. Die Entscheidung trifft assets/js/nalp-passstueck-tal.js (EINE Stelle, auch fuer die
Batch-Uebersicht); dieses Skript liefert nur die Daten dazu:

    p  je Passstueck  "469_S2": [Soll-Laenge mm | null, Flags, Nalpi-Bestellbatch]
                      Flags: 1 = Berechnung/Geometrie veraltet, 2 = «falsch geliefert» offen, 4 = bei ILF freigegeben
    t  je Tisch       "469": [Bereich, Typ (geometry_code), montiert am, vormontiert am, zurueckgezogen 0/1]
    b  je Passstueck  "440_S2": [[Batch, Laenge, gueltig 1/0], ...]  alle Bestellungen 2026 aus
                      assets/js/nalp-passstueck-daten.js (gueltig 0 = spaeter neu bestellt). NOETIG, weil Nalpi
                      je Bein nur EINE Bestellung fuehrt (oft die alte Batch-Nr.) - ersetzte Stuecke sieht man dort nicht.
    bekannt           Einzelfaelle, die Nalpi falsch fuehrt (Beleg im Text).

Quellen: Query-Engine GET /api/w1/q/passstuecke (braucht office:read) und /api/w1/q/tables (plan:read).
TOKEN wie tools/nalpi_stand_api.py: NALPS_API_TOKEN oder NALPS_API_TOKEN_FILE.
Fehlt office:read (401/403), endet das Skript mit 0 und laesst die alte Datei stehen - die Kette in
nalpi_stand_api.py laeuft weiter.

Aufruf (aus Website_NalpSolar):  python tools/build_ps_tal.py [--basis https://...]
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nalpi_stand_api import BASIS, token_lesen  # noqa: E402

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(BASE, 'uploads', 'tables', 'ps_tal.json')
DATEN_JS = os.path.join(BASE, 'assets', 'js', 'nalp-passstueck-daten.js')
SEITE = 5000

PS_SPALTEN = ('foundation_id,table_key,leg,abs_length,approval_status,order_batch_no,'
              'wrong_delivery_unresolved,calc_stale,geometry_stale')
TISCH_SPALTEN = 'table_key,geometry_code,bereich_key,assembled_on,preassembled_on,withdrawn_on'

# Einzelfaelle, die Nalpi falsch fuehrt: [Klasse, Text, Laenge auf dem Etikett (nur dann gilt der Fall), Ziel]
BEKANNT = {
    '370_S1': ['weg', 'Zu kurz: Pfahl S1 abgesackt (-518 mm). Am Tisch steckt 1076_S4 als Spender '
                      '(Entscheid 06.08.2026). Nalpi fuehrt noch die alte Laenge.', 2358, 'entsorgen'],
}


class KeinZugang(Exception):
    pass


def abfragen(basis: str, token: str, view: str, spalten: str) -> list[dict]:
    """GET /api/w1/q/<view>, blaettert mit limit/offset bis zur kurzen Seite."""
    alle: list[dict] = []
    offset = 0
    while True:
        q = urllib.parse.urlencode({'select': spalten, 'limit': SEITE, 'offset': offset})
        req = urllib.request.Request(basis + '/api/w1/q/' + view + '?' + q, headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json',
            'User-Agent': 'Website_NalpSolar build_ps_tal.py',
        })
        seite = None
        for versuch in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as antwort:
                    seite = json.loads(antwort.read().decode('utf-8'))
                break
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    raise KeinZugang('%s: HTTP %d' % (view, e.code))
                if e.code == 416:
                    seite = []
                    break
                if e.code == 429 and versuch < 2:
                    time.sleep(int(e.headers.get('Retry-After') or 60))
                    continue
                if e.code == 503 and versuch < 2:
                    time.sleep(5)
                    continue
                sys.exit('FEHLER %d bei /api/w1/q/%s' % (e.code, view))
            except urllib.error.URLError as e:
                sys.exit('FEHLER: %s nicht erreichbar (%s)' % (basis, e.reason))
        if not isinstance(seite, list):
            sys.exit('FEHLER: /api/w1/q/%s antwortet nicht mit einer Liste.' % view)
        alle.extend(seite)
        if len(seite) < SEITE:
            return alle
        offset += len(seite)


def bestellungen_lesen() -> dict[str, list]:
    """Alle Bestellpositionen aus nalp-passstueck-daten.js: [tisch, stuetze, laenge, batch, datum, bauteil, gueltig]."""
    with io.open(DATEN_JS, encoding='utf-8') as f:
        txt = f.read()
    marke = 'window.NALP_PS_DATEN = '
    roh = txt[txt.index(marke) + len(marke):txt.rindex('}') + 1]
    daten = json.loads(roh)
    b: dict[str, list] = {}
    for z in daten.get('bestellungen') or []:
        key = '%s_%s' % (int(z[0]) if str(z[0]).isdigit() else z[0], z[1])
        b.setdefault(key, []).append([str(z[3]), round(float(z[2]), 1), 1 if z[6] in (1, True, '1') else 0])
    return b


def main() -> int:
    ap = argparse.ArgumentParser(description='ps_tal.json fuer den Passstueck-Check im Tal bauen.')
    ap.add_argument('--basis', default=BASIS, help='API-Host (Vorgabe %s)' % BASIS)
    a = ap.parse_args()
    basis = a.basis.rstrip('/')
    token = token_lesen()

    try:
        ps = abfragen(basis, token, 'passstuecke', PS_SPALTEN)
        tische = abfragen(basis, token, 'tables', TISCH_SPALTEN)
    except KeinZugang as e:
        # In GitHub Actions als Warnung sichtbar, aber kein roter Lauf: die anderen Builder sollen weiterlaufen.
        print('::warning title=ps_tal.json nicht gebaut::Token ohne Leserecht (%s) - braucht office:read + plan:read. '
              'Alte Datei bleibt stehen.' % e)
        return 0

    if len(ps) < 1000 or len(tische) < 1000:
        print('  ! zu wenig Zeilen (passstuecke %d, tables %d) - ps_tal.json bleibt unveraendert' % (len(ps), len(tische)))
        return 0

    p: dict[str, list] = {}
    for r in ps:
        key = r.get('foundation_id')
        if not key:
            continue
        flags = 0
        if r.get('calc_stale') or r.get('geometry_stale'):
            flags |= 1
        if r.get('wrong_delivery_unresolved'):
            flags |= 2
        if r.get('approval_status') == 'Approved':
            flags |= 4
        laenge = r.get('abs_length')
        p[key] = [round(float(laenge), 1) if laenge is not None else None, flags, r.get('order_batch_no') or '']

    t: dict[str, list] = {}
    for r in tische:
        t[str(r['table_key'])] = [r.get('bereich_key') or '', r.get('geometry_code') or '',
                                  r.get('assembled_on') or '', r.get('preassembled_on') or '',
                                  1 if r.get('withdrawn_on') else 0]

    b = bestellungen_lesen()
    try:
        from zoneinfo import ZoneInfo
        zone = ZoneInfo('Europe/Zurich')
    except Exception:  # Windows ohne tzdata: Winterzeit reicht fuer die Anzeige
        zone = dt.timezone(dt.timedelta(hours=1))
    stand = dt.datetime.now(dt.timezone.utc).astimezone(zone)
    raus = {
        'stand': stand.strftime('%Y-%m-%d %H:%M'),
        'quelle': 'api.buildtrack.ch /api/w1/q/passstuecke + /tables; Bestellungen 2026 aus nalp-passstueck-daten.js',
        'p': p, 't': t, 'b': b, 'bekannt': BEKANNT,
    }
    os.makedirs(os.path.dirname(ZIEL), exist_ok=True)
    with io.open(ZIEL, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(raus, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n')
    montiert = sum(1 for v in t.values() if v[2])
    print('  ps_tal.json: %d Passstuecke, %d Tische (%d montiert), %d Positionen mit Bestellung'
          % (len(p), len(t), montiert, len(b)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
