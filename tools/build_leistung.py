# -*- coding: utf-8 -*-
r"""build_leistung.py - Wochenleistung je Gewerk fuer den Sitzungsreiter.

Victor am 27.08.2026: nicht die Gesamtzahlen zaehlen in der Sitzung, sondern die
LEISTUNG - wie viel ist diese Woche dazugekommen. Genau das steht in Nalpi, aber
nicht in baustand.json/bohrstand.json (die kennen nur den Status, kein Datum).
Darum rechnet dieses Skript aus den Nalpi-Rohexporten:

    uploads/_nalpi/DRILLING_POINT_DATA-<Datum>.csv   STAK/DRILL/SURVEY/INJ_DATE
    uploads/_nalpi/export-tableId-<Datum>.csv        PK / Modultraeger / verschraubt
                        ->  uploads/tables/leistung.json

Damit zeichnet der Admin-Reiter «Sitzung» das Wochenleistungs-Diagramm, ohne dass
jemand Zahlen abtippt.

FALLSTRICK ZEITZONE: Nalpi legt ein Datum als "T22:00:00Z" des VORTAGS ab (Mitternacht
Schweizer Zeit). Ein rohes [:10] liefert deshalb einen Tag zu frueh - an einem
Sonntag/Montag rutscht die Leistung damit in die falsche Kalenderwoche. Hier wird
konsequent nach Europe/Zurich umgerechnet (siehe Memory zur 22:00Z-Falle).

Aufruf:
    python tools/build_leistung.py                  juengste Exporte nehmen
    python tools/build_leistung.py --wochen 10      wie viele KW ins Diagramm
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
ZIEL = os.path.join(TABLES, 'leistung.json')

ZRH = ZoneInfo('Europe/Zurich')

# Was gezeichnet wird: Schluessel -> (Anzeigename, Farbe wie im Protokollplot)
GEWERKE = [
    ('abgesteckt', 'abgesteckt', '#3a86e0'),
    ('gebohrt',    'gebohrt',    '#f08a24'),
    ('vermessen',  'vermessen',  '#a55ee0'),
    ('injiziert',  'injiziert',  '#2e9e46'),
    ('pk',         'Primärkonstruktion', '#D72622'),
    ('mt',         'Modulträger', '#1a5fb4'),
    ('verschraubt', 'verschraubt', '#8a5a00'),
]


def tag_lokal(wert):
    """Nalpi-Datum -> date in Schweizer Zeit. Leer/unlesbar -> None.

    Nalpi schreibt '2026-08-17T22:00:00Z' fuer den 18.08. - wer [:10] nimmt,
    landet einen Tag zu frueh und in ungluecklichen Faellen in der Vorwoche.
    """
    if not wert:
        return None
    s = str(wert).strip()
    if not s or s in ('—', '-', 'None'):
        return None
    # Schon deutsch formatiert (export-tableId schreibt "18.8.2026")
    m = re.match(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})$', s)
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


def kw_von(d: dt.date):
    """(Jahr, Kalenderwoche) nach ISO."""
    iso = d.isocalendar()
    return (iso[0], iso[1])


def montag(jahr, woche) -> dt.date:
    return dt.date.fromisocalendar(jahr, woche, 1)


def arbeitstage(von: dt.date, bis: dt.date, heute: dt.date) -> int:
    """Mo-Fr im Zeitraum, aber hoechstens bis heute - sonst rechnet die
    laufende Woche mit Tagen, die noch gar nicht stattgefunden haben."""
    ende = min(bis, heute)
    n = 0
    t = von
    while t <= ende:
        if t.weekday() < 5:
            n += 1
        t += dt.timedelta(days=1)
    return n


def juengste(muster: str):
    treffer = sorted(glob.glob(os.path.join(ROH, muster)))
    return treffer[-1] if treffer else None


def lies_csv(pfad):
    with io.open(pfad, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def bereiche_laden():
    p = os.path.join(TABLES, 'bereiche.json')
    if not os.path.exists(p):
        return {}
    with io.open(p, encoding='utf-8') as f:
        return (json.load(f) or {}).get('bereiche', {}) or {}


def tisch_aus(fid: str) -> str:
    """'399_S1' -> '399'."""
    return str(fid or '').split('_')[0]


def main() -> int:
    ap = argparse.ArgumentParser(description='Wochenleistung fuer den Sitzungsreiter bauen.')
    ap.add_argument('--wochen', type=int, default=8, help='wie viele Kalenderwochen (Vorgabe 8)')
    a = ap.parse_args()

    p_bohr = juengste('DRILLING_POINT_DATA-*.csv')
    p_tisch = juengste('export-tableId-*.csv')
    if not p_bohr and not p_tisch:
        print('FEHLER: keine Nalpi-Rohexporte in uploads/_nalpi - erst NALPI_STAND_HOLEN.bat laufen lassen.')
        return 1

    heute = dt.datetime.now(ZRH).date()
    bereiche = bereiche_laden()

    # ── je Kalenderwoche zaehlen ────────────────────────────────────────────
    zaehler = {}          # (jahr, kw) -> {gewerk: anzahl}

    def buche(datum, feld):
        if not datum:
            return
        s = zaehler.setdefault(kw_von(datum), {})
        s[feld] = s.get(feld, 0) + 1

    offen_inj, offen_verm = {}, {}     # Bereich -> [gebohrt, fertig]
    summe = {k: 0 for k, _, _ in GEWERKE}

    if p_bohr:
        for r in lies_csv(p_bohr):
            stak = tag_lokal(r.get('STAK_DATE'))
            bohr = tag_lokal(r.get('DRILL_DATE'))
            verm = tag_lokal(r.get('SURVEY_DATE'))
            inj = tag_lokal(r.get('INJ_DATE'))
            buche(stak, 'abgesteckt'); buche(bohr, 'gebohrt')
            buche(verm, 'vermessen'); buche(inj, 'injiziert')
            for d, k in ((stak, 'abgesteckt'), (bohr, 'gebohrt'),
                         (verm, 'vermessen'), (inj, 'injiziert')):
                if d:
                    summe[k] += 1
            if bohr:
                b = bereiche.get(tisch_aus(r.get('FOUNDATION_ID')), '?')
                if not inj:
                    e = offen_inj.setdefault(b, [0, 0]); e[0] += 1
                else:
                    e = offen_inj.setdefault(b, [0, 0]); e[0] += 1; e[1] += 1
                if not verm:
                    e2 = offen_verm.setdefault(b, [0, 0]); e2[0] += 1
                else:
                    e2 = offen_verm.setdefault(b, [0, 0]); e2[0] += 1; e2[1] += 1

    if p_tisch:
        for r in lies_csv(p_tisch):
            for spalte, feld in (('Primärkonstruktion montiert', 'pk'),
                                 ('Modulträger montiert', 'mt'),
                                 ('Modultisch verschraubt', 'verschraubt')):
                d = tag_lokal(r.get(spalte))
                buche(d, feld)
                if d:
                    summe[feld] += 1

    # ── die letzten N Wochen ausgeben ───────────────────────────────────────
    jahr, kw = kw_von(heute)
    wochen = []
    for zurueck in range(a.wochen - 1, -1, -1):
        mo = montag(jahr, kw) - dt.timedelta(weeks=zurueck)
        j2, k2 = kw_von(mo)
        so = mo + dt.timedelta(days=6)
        werte = zaehler.get((j2, k2), {})
        eintrag = {'kw': k2, 'jahr': j2, 'von': mo.isoformat(), 'bis': so.isoformat(),
                   'at': arbeitstage(mo, so, heute), 'laufend': mo <= heute <= so}
        for k, _, _ in GEWERKE:
            eintrag[k] = werte.get(k, 0)
        wochen.append(eintrag)

    def rueckstand(roh):
        liste = [{'bereich': b, 'gebohrt': v[0], 'fertig': v[1], 'offen': v[0] - v[1]}
                 for b, v in roh.items() if v[0] - v[1] > 0]
        liste.sort(key=lambda x: -x['offen'])
        return {'gesamt': sum(x['offen'] for x in liste), 'bereiche': liste[:8]}

    raus = {
        'stand': heute.isoformat(),
        'gebaut_am': dt.datetime.now(ZRH).strftime('%Y-%m-%d %H:%M'),
        'quelle': ' + '.join(os.path.basename(p) for p in (p_bohr, p_tisch) if p),
        'gewerke': [{'id': k, 'name': n, 'farbe': f} for k, n, f in GEWERKE],
        'wochen': wochen,
        'summe': summe,
        'rueckstand': {'injektion': rueckstand(offen_inj),
                       'vermessung': rueckstand(offen_verm)},
    }
    os.makedirs(TABLES, exist_ok=True)
    with io.open(ZIEL, 'w', encoding='utf-8') as f:
        json.dump(raus, f, ensure_ascii=False, separators=(',', ':'))

    letzte = wochen[-1] if wochen else {}
    print('leistung.json geschrieben (%d Wochen, Stand %s)' % (len(wochen), heute.isoformat()))
    print('  KW%s: abgesteckt %d · gebohrt %d · vermessen %d · injiziert %d · PK %d · MT %d'
          % (letzte.get('kw', '?'), letzte.get('abgesteckt', 0), letzte.get('gebohrt', 0),
             letzte.get('vermessen', 0), letzte.get('injiziert', 0),
             letzte.get('pk', 0), letzte.get('mt', 0)))
    print('  Rueckstand Injektion %d · Vermessung %d'
          % (raus['rueckstand']['injektion']['gesamt'],
             raus['rueckstand']['vermessung']['gesamt']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
