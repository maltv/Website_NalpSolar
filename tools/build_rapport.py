# -*- coding: utf-8 -*-
r"""build_rapport.py - Tagesdaten fuer den Tagesrapport aus den Nalpi-Rohexporten.

WARUM ES DIESE DATEI GIBT: Der Tagesrapport wird um 19:00 in der Google-Cloud
verschickt, ohne dass der Buero-PC laeuft. Die Cloud kommt aber NICHT an Nalpi
heran - dafuer braucht es den angemeldeten Edge auf Victors PC. Und der
oeffentliche Spiegel api.buildtrack.ch steht seit dem 28.07.2026 still, taugt
also nicht als Ersatz (geprueft 31.08.2026, watermark 79066).

Darum rechnet der PC die Zahlen aus, sobald er Nalpi ohnehin abfragt, und legt
sie als kleine Datei auf der Website ab:

    uploads/_nalpi/DRILLING_POINT_DATA-<Datum>.csv   STAK/DRILL/SURVEY/INJ_DATE
    uploads/_nalpi/export-tableId-<Datum>.csv        PK / Modultraeger / verschraubt
                        ->  uploads/tables/rapport.json

Die Cloud liest diese Datei ueber GitHub Pages. Was sie NICHT hier findet
(Vormontage im Tal), holt sie live aus der Firebase-Datenbank.

baustand.json reicht dafuer nicht: es kennt nur Tische MIT Primaerkonstruktion,
keine Bohrdaten und keine Tagesreihen.

FALLSTRICK ZEITZONE: Nalpi legt ein Datum als "T22:00:00Z" des VORTAGS ab
(Mitternacht Schweizer Zeit). Ein rohes [:10] liefert einen Tag zu frueh - der
Rapport wuerde die Arbeit von heute auf gestern buchen. Darum ueberall
tag_lokal(); gleiche Falle wie in build_leistung.py und Vormontage_Nach_Nalpi.py.

Aufruf (aus Website_NalpSolar):
    python tools/build_rapport.py                        juengste Exporte nehmen
    python tools/build_rapport.py <bohr.csv> <tisch.csv> bestimmte Exporte
    python tools/build_rapport.py --tage 21              wie weit zurueck (Vorgabe 14)

Laeuft in Tools\Nalpi_Stand_Abholen.py automatisch mit.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import glob
import io
import json
import os
import re
import sys
from zoneinfo import ZoneInfo

HIER = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HIER)
ROH = os.path.join(WEB, 'uploads', '_nalpi')
TABLES = os.path.join(WEB, 'uploads', 'tables')
ZIEL = os.path.join(TABLES, 'rapport.json')

ZRH = ZoneInfo('Europe/Zurich')

# Spalte im Tischexport -> Schluessel im Rapport
TISCHSPALTEN = [
    ('Primärkonstruktion montiert', 'pk'),
    ('Modulträger montiert', 'mt'),
    ('Modultisch verschraubt', 'vs'),
]
# Spalte im Bohrpunktexport -> Schluessel im Rapport
BOHRSPALTEN = [
    ('STAK_DATE', 'abgesteckt'),
    ('DRILL_DATE', 'gebohrt'),
    ('SURVEY_DATE', 'vermessen'),
    ('INJ_DATE', 'injiziert'),
]


def tag_lokal(wert):
    """Nalpi-Datum -> date in Schweizer Zeit. Leer/unlesbar -> None."""
    if not wert:
        return None
    s = str(wert).strip()
    if not s or s in ('—', '-', 'None'):
        return None
    m = re.match(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})$', s)      # "18.8.2026"
    if m:
        try:
            return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    try:
        if s.endswith('Z'):
            roh = dt.datetime.fromisoformat(s[:-1]).replace(tzinfo=dt.timezone.utc)
            return roh.astimezone(ZRH).date()
        d = dt.datetime.fromisoformat(s)
        if d.tzinfo is not None:
            return d.astimezone(ZRH).date()
        return d.date()
    except ValueError:
        try:
            return dt.date.fromisoformat(s[:10])
        except ValueError:
            return None


def juengste(muster):
    treffer = sorted(glob.glob(os.path.join(ROH, muster)))
    return treffer[-1] if treffer else None


def lies_csv(pfad):
    with io.open(pfad, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def bereiche_laden():
    """{TischId: Bereichsname} aus dem Nalpi-Export. Fehlt die Datei, bleibt
    der Bereich leer - der Rapport zeigt dann nur die Gesamtzahl."""
    p = os.path.join(TABLES, 'bereiche.json')
    if not os.path.exists(p):
        return {}
    with io.open(p, encoding='utf-8') as f:
        return (json.load(f) or {}).get('bereiche', {}) or {}


def tisch_aus(fid):
    """'399_S1' -> '399'."""
    return str(fid or '').split('_')[0]


def top(zaehler, n=3):
    """Die groessten Posten als [[name, anzahl], ...] - fuer die Klammer im
    Rapport ("Injektion 272 offen, davon 26_5.1: 88")."""
    return [[k, v] for k, v in sorted(zaehler.items(), key=lambda x: -x[1])[:n]]


def main():
    ap = argparse.ArgumentParser(description='Tagesdaten fuer den Tagesrapport bauen.')
    ap.add_argument('dateien', nargs='*', help='Bohrpunkt- und Tischexport (sonst die juengsten)')
    ap.add_argument('--tage', type=int, default=14, help='wie viele Tage Rueckschau (Vorgabe 14)')
    a = ap.parse_args()

    p_bohr = p_tisch = None
    for d in a.dateien:
        name = os.path.basename(d).upper()
        if 'DRILLING' in name:
            p_bohr = d
        elif 'TABLEID' in name or 'TABLE_ID' in name:
            p_tisch = d
    p_bohr = p_bohr or juengste('DRILLING_POINT_DATA-*.csv')
    p_tisch = p_tisch or juengste('export-tableId-*.csv')
    if not p_bohr or not p_tisch:
        print('FEHLER: Nalpi-Rohexporte fehlen in uploads/_nalpi - erst NALPI_STAND_HOLEN.bat laufen lassen.')
        return 1

    # WANN NALPI GELESEN WURDE - nicht wann diese Datei gebaut wird. Der
    # Rapport sagt spaeter "Nalpi-Stand von heute 08:18 Uhr"; stuende dort die
    # Rechenzeit, waere die Zahl zu frisch dargestellt (baut man die Datei um
    # 15:26 aus dem Export von 08:18 neu, hat sich an den Daten nichts
    # geaendert). Massgebend ist der aeltere der beiden Exporte - und sein Tag
    # ist der Stichtag des Rapports, nicht das heutige Datum. Sonst behauptet
    # ein Lauf mit altem Export, er zeige den Stand von heute.
    gelesen = dt.datetime.fromtimestamp(
        min(os.path.getmtime(p) for p in (p_bohr, p_tisch)), ZRH)
    heute = gelesen.date()
    ab = heute - dt.timedelta(days=a.tage - 1)
    bereiche = bereiche_laden()

    # -- Bohren / Injektion -------------------------------------------------
    b_tage = {}          # 'JJJJ-MM-TT' -> {gewerk: anzahl}
    b_summe = {k: 0 for _, k in BOHRSPALTEN}
    b_bereich = {}       # gewerk -> {Bereich: Anzahl}, nur fuer den Stichtag
    offen_inj, offen_verm = {}, {}
    punkte = 0

    for r in lies_csv(p_bohr):
        punkte += 1
        bereich = bereiche.get(tisch_aus(r.get('FOUNDATION_ID')), '?')
        werte = {}
        for spalte, schluessel in BOHRSPALTEN:
            d = tag_lokal(r.get(spalte))
            werte[schluessel] = d
            if not d:
                continue
            b_summe[schluessel] += 1
            if d >= ab:
                tag = b_tage.setdefault(d.isoformat(), {})
                tag[schluessel] = tag.get(schluessel, 0) + 1
                if d == heute:
                    je = b_bereich.setdefault(schluessel, {})
                    je[bereich] = je.get(bereich, 0) + 1
        # Was gebohrt ist, muss noch vermessen und injiziert werden.
        if werte['gebohrt']:
            if not werte['injiziert']:
                offen_inj[bereich] = offen_inj.get(bereich, 0) + 1
            if not werte['vermessen']:
                offen_verm[bereich] = offen_verm.get(bereich, 0) + 1

    # -- Stahlbau -----------------------------------------------------------
    # Hier stehen die Tisch-Nummern, nicht nur die Anzahl: der Rapport nennt
    # sie im Text, und der Abgleich mit dem Tal braucht sie.
    s_tage = {}          # 'JJJJ-MM-TT' -> {gewerk: [TischNr, ...]}
    s_summe = {k: 0 for _, k in TISCHSPALTEN}
    tische = 0

    for r in lies_csv(p_tisch):
        tische += 1
        nr = str(r.get('Nr.') or '').strip()
        for spalte, schluessel in TISCHSPALTEN:
            d = tag_lokal(r.get(spalte))
            if not d:
                continue
            s_summe[schluessel] += 1
            if d >= ab and nr:
                s_tage.setdefault(d.isoformat(), {}).setdefault(schluessel, []).append(nr)

    for tag in s_tage.values():
        for liste in tag.values():
            liste.sort(key=lambda x: (len(x), x))

    raus = {
        'stand': heute.isoformat(),
        'nalpi_gelesen': gelesen.strftime('%Y-%m-%d %H:%M'),
        'gebaut_am': dt.datetime.now(ZRH).strftime('%Y-%m-%d %H:%M'),
        'quelle': ' + '.join(os.path.basename(p) for p in (p_bohr, p_tisch)),
        'bohren': {
            'gesamt': punkte,
            'summe': b_summe,
            'tage': b_tage,
            'bereiche_heute': b_bereich,
            'offen': {
                'injektion': {'gesamt': sum(offen_inj.values()), 'top': top(offen_inj)},
                'vermessung': {'gesamt': sum(offen_verm.values()), 'top': top(offen_verm)},
            },
        },
        'stahlbau': {
            'gesamt': tische,
            'summe': s_summe,
            'tage': s_tage,
        },
    }

    os.makedirs(TABLES, exist_ok=True)
    with io.open(ZIEL, 'w', encoding='utf-8') as f:
        json.dump(raus, f, ensure_ascii=False, separators=(',', ':'))

    h = heute.isoformat()
    bh = b_tage.get(h, {})
    sh = s_tage.get(h, {})
    print('rapport.json geschrieben (Stand %s, %d Tage Rueckschau)' % (h, a.tage))
    print('  heute: gebohrt %d - injiziert %d - vermessen %d - abgesteckt %d'
          % (bh.get('gebohrt', 0), bh.get('injiziert', 0),
             bh.get('vermessen', 0), bh.get('abgesteckt', 0)))
    print('  heute: PK %d - Modultraeger %d - verschraubt %d'
          % (len(sh.get('pk', [])), len(sh.get('mt', [])), len(sh.get('vs', []))))
    print('  offen: Injektion %d - Vermessung %d'
          % (raus['bohren']['offen']['injektion']['gesamt'],
             raus['bohren']['offen']['vermessung']['gesamt']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
