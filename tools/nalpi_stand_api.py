# -*- coding: utf-8 -*-
r"""nalpi_stand_api.py - Baustand + Bohrstand aus dem Buildtrack-API statt aus dem angemeldeten Edge.

Ersetzt den taeglichen Edge-Abgriff (Tools\Nalpi_Stand_Abholen.py / NALPI_STAND_HOLEN.bat).
Das API liefert dieselben zwei Dateien, die die Builder hier schon lesen - mit denselben Spalten,
denselben Datumsformen ("18.8.2026" bzw. "2026-08-17T22:00:00Z") und derselben Reihenfolge:

    GET https://api.buildtrack.ch/api/w1/exports/drilling-point-data.csv -> uploads/_nalpi/DRILLING_POINT_DATA-<Tag>.csv
    GET https://api.buildtrack.ch/api/w1/exports/table-id.csv            -> uploads/_nalpi/export-tableId-<Tag>.csv

Danach laufen die Builder:

    build_modultische_api.py (Query-Engine /api/w1/q/tables) -> uploads/tables/modultische_all.json
                        (alle Tische mit Zentrum, Azimut, h_soll und SOLL-Pfahlpunkten S1-S4; seit 23.10.2026
                         statt der ILF-Belegung-Excels aus der Dropbox - dort fehlten 229 Tische aus Bereich 9)
    build_bohrstand.py <DRILLING_POINT_DATA-<Tag>.csv>  -> uploads/tables/bohrstand.json + bohrpunkte_koo.json
    build_baustand.py  <export-tableId-<Tag>.csv>       -> uploads/tables/baustand.json
    build_rapport.py                                    -> uploads/tables/rapport.json
    und direkt aus dem Tischexport:                        uploads/tables/bereiche.json
                        (Tisch -> Bauphasen_STRABAG_260410, fuer schrauben/verschrauben/injektion)

TOKEN: Umgebungsvariable NALPS_API_TOKEN, oder NALPS_API_TOKEN_FILE = Pfad einer Datei, die nur den
Token enthaelt. Nie als Aufrufargument, nie ins Repo. Noetige Bereiche des Kontos: plan:read (Tische)
und drill:read (Bohrpunkte). In GitHub Actions kommt er aus dem Repository-Secret NALPS_API_TOKEN
(.github/workflows/nalpi-stand.yml).

FRISCHE: Was die Bohr-App meldet, steht sofort im API. Die SharePoint-Felder (Montage-Daten der
Tische) laedt der Kern alle 30 Minuten; der Header x-nalps-last-load-at nennt die letzte Ladung und
wird unten ausgegeben.

Aufruf (aus Website_NalpSolar):
    python tools/nalpi_stand_api.py                  holen + alles bauen
    python tools/nalpi_stand_api.py --nur-holen      nur die zwei CSV holen
    python tools/nalpi_stand_api.py --mit-leistung   zusaetzlich build_leistung.py (Sitzungsseite)
    python tools/nalpi_stand_api.py --basis https://... anderer Host (Test)

Exit 1 bei einem HTTP-Fehler: 401/403 = Token fehlt oder hat die Bereiche nicht; 503 = das API hat die
Abfrage nach 10 s abgebrochen - einfach noch einmal. Dann wird NICHTS gebaut und nichts geschrieben.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROH = os.path.join(BASE, 'uploads', '_nalpi')          # gitignored
TABLES = os.path.join(BASE, 'uploads', 'tables')
TOOLS = os.path.dirname(os.path.abspath(__file__))
ZRH = ZoneInfo('Europe/Zurich')

BASIS = 'https://api.buildtrack.ch'
# (Pfad im API, Dateiname-Vorlage; der Tag kommt aus content-disposition, sonst heute Zuerich)
EXPORTE = [
    ('/api/w1/exports/drilling-point-data.csv', 'DRILLING_POINT_DATA-%s.csv'),
    ('/api/w1/exports/table-id.csv', 'export-tableId-%s.csv'),
]
BEREICH_SPALTE = 'Bauphasen_STRABAG_260410'


def token_lesen() -> str:
    """Token aus NALPS_API_TOKEN oder aus der Datei NALPS_API_TOKEN_FILE. Nie ausgeben."""
    t = (os.environ.get('NALPS_API_TOKEN') or '').strip()
    if t:
        return t
    pfad = (os.environ.get('NALPS_API_TOKEN_FILE') or '').strip()
    if pfad:
        with io.open(os.path.expanduser(pfad), encoding='utf-8') as f:
            t = f.read().strip()
        if t:
            return t
    sys.exit('FEHLER: kein Token. NALPS_API_TOKEN setzen oder NALPS_API_TOKEN_FILE auf eine Datei zeigen lassen.')


def tag_aus_header(disposition: str | None) -> str | None:
    """'attachment; filename="export-tableId-2026-10-17.csv"' -> '2026-10-17'."""
    if not disposition:
        return None
    m = re.search(r'(\d{4}-\d{2}-\d{2})', disposition)
    return m.group(1) if m else None


def holen(basis: str, token: str) -> list[str]:
    """Die zwei Exporte holen; Liste der geschriebenen Pfade (Bohrpunkte zuerst)."""
    os.makedirs(ROH, exist_ok=True)
    heute = dt.datetime.now(ZRH).date().isoformat()
    pfade = []
    for pfad_api, vorlage in EXPORTE:
        req = urllib.request.Request(basis + pfad_api, headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'text/csv',
            'User-Agent': 'Website_NalpSolar nalpi_stand_api.py',
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as antwort:
                daten = antwort.read()
                tag = tag_aus_header(antwort.headers.get('content-disposition')) or heute
                geladen = antwort.headers.get('x-nalps-last-load-at') or '?'
                wasserstand = antwort.headers.get('x-nalps-watermark') or '?'
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                sys.exit('FEHLER %d bei %s: Token fehlt/abgelaufen oder das Konto hat den Bereich nicht '
                         '(plan:read fuer Tische, drill:read fuer Bohrpunkte).' % (e.code, pfad_api))
            if e.code == 503:
                sys.exit('FEHLER 503 bei %s: das API hat die Abfrage abgebrochen - einfach noch einmal starten.' % pfad_api)
            sys.exit('FEHLER %d bei %s' % (e.code, pfad_api))
        except urllib.error.URLError as e:
            sys.exit('FEHLER: %s nicht erreichbar (%s)' % (basis, e.reason))
        if not daten.lstrip(b'\xef\xbb\xbf').startswith(b'"'):
            sys.exit('FEHLER: %s antwortet nicht mit einer CSV-Datei (%d Bytes, beginnt mit %r).'
                     % (pfad_api, len(daten), daten[:40]))
        ziel = os.path.join(ROH, vorlage % tag)
        with io.open(ziel, 'wb') as f:
            f.write(daten)
        zeilen = daten.count(b'\n') + (0 if daten.endswith(b'\n') else 1) - 1
        print('  %-36s %6d Zeilen  (SharePoint zuletzt geladen %s, Wasserstand %s)'
              % (os.path.basename(ziel), zeilen, geladen, wasserstand))
        pfade.append(ziel)
    return pfade


def bereiche_bauen(tisch_csv: str) -> None:
    """uploads/tables/bereiche.json: Tisch -> Bereichsname aus der Spalte Bauphasen_STRABAG_260410.
    Gleiche Form wie bisher (Schluessel als Text sortiert, Einzug 1). Eine fast leere Spalte ueberschreibt
    den alten Stand nicht - dann stimmt etwas am Export, nicht an der Baustelle."""
    ziel = os.path.join(TABLES, 'bereiche.json')
    with io.open(tisch_csv, encoding='utf-8-sig', newline='') as f:
        leser = csv.DictReader(f)
        if BEREICH_SPALTE not in (leser.fieldnames or []):
            print('  ! Spalte %s fehlt im Tischexport - bereiche.json bleibt.' % BEREICH_SPALTE)
            return
        neu = {}
        for r in leser:
            tid = (r.get('Nr.') or '').strip()
            b = (r.get(BEREICH_SPALTE) or '').strip()
            if tid and b:
                neu[tid] = b
    alt = {}
    if os.path.exists(ziel):
        try:
            alt = (json.load(io.open(ziel, encoding='utf-8')) or {}).get('bereiche', {}) or {}
        except ValueError:
            alt = {}
    if alt and len(neu) < 0.9 * len(alt):
        print('  ! nur %d Tische mit Bereich (bisher %d) - bereiche.json bleibt.' % (len(neu), len(alt)))
        return
    stand = re.search(r'(\d{4}-\d{2}-\d{2})', os.path.basename(tisch_csv))
    raus = {'stand': stand.group(1) if stand else dt.date.today().isoformat(),
            'quelle': 'api.buildtrack.ch /api/w1/exports/table-id.csv, Spalte ' + BEREICH_SPALTE,
            'bereiche': dict(sorted(neu.items()))}
    with io.open(ziel, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(raus, ensure_ascii=False, indent=1) + '\n')
    print('  bereiche.json: %d Tische mit Bereich (bisher %d)' % (len(neu), len(alt)))


def bauen(skript: str, *argv: str) -> None:
    cmd = [sys.executable, os.path.join(TOOLS, skript), *argv]
    print('> ' + ' '.join(os.path.basename(c) if c.startswith(BASE) else c for c in cmd))
    rc = subprocess.call(cmd, cwd=BASE)
    if rc != 0:
        sys.exit('FEHLER: %s endete mit %d' % (skript, rc))


def main() -> int:
    ap = argparse.ArgumentParser(description='Baustand + Bohrstand aus dem Buildtrack-API holen und bauen.')
    ap.add_argument('--basis', default=BASIS, help='API-Host (Vorgabe %s)' % BASIS)
    ap.add_argument('--nur-holen', action='store_true', help='nur die zwei CSV nach uploads/_nalpi holen')
    ap.add_argument('--mit-leistung', action='store_true', help='zusaetzlich build_leistung.py laufen lassen')
    a = ap.parse_args()

    token = token_lesen()
    print('Exporte holen von %s:' % a.basis)
    bohr_csv, tisch_csv = holen(a.basis.rstrip('/'), token)
    if a.nur_holen:
        return 0

    bauen('build_modultische_api.py', '--basis', a.basis)
    bauen('build_bohrstand.py', bohr_csv)
    bauen('build_baustand.py', tisch_csv)
    bereiche_bauen(tisch_csv)
    bauen('build_rapport.py', bohr_csv, tisch_csv)
    if a.mit_leistung:
        bauen('build_leistung.py')
    print('Fertig: uploads/tables/{modultische_all,bohrstand,bohrpunkte_koo,baustand,bereiche,rapport}.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
