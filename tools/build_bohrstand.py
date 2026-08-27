# -*- coding: utf-8 -*-
"""Erzeugt uploads/tables/bohrstand.json (Bohrpunkt-Ebene fuer den 3D-Viewer).

Zwei Nalpi-Exporte werden verstanden:

  A) DRILLING_POINT_DATA.csv       (Vollexport der Bohrpunkte)
     -> Koordinaten LV95 + Hoehe (SOLL_*, IST_* wenn gebohrt) UND Status
        aus den Datumsfeldern STAK/DRILL/SURVEY/INJ.
     Die Koordinaten werden zusaetzlich in uploads/tables/bohrpunkte_koo.json
     zwischengespeichert, damit spaetere Status-Updates ohne Vollexport gehen.

  B) export-pointId-JJJJ-MM-TT.csv (Tagesexport aus der Nalpi-Ansicht)
     -> nur Status je Pfahl; Koordinaten kommen aus dem Cache (A).

Ausgabe je Pfahl: [tischId, stuetze 1..4, E, N, H, status 0..4, nachbohrungen]
Status: 0 Geplant · 1 Abgesteckt · 2 Gebohrt · 3 Pfähle fixiert · 4 Injiziert

Aufruf:  python tools/build_bohrstand.py <csv> [weitere csv ...]
"""
import csv, io, json, os, re, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KOO_CACHE = os.path.join(BASE, 'uploads', 'tables', 'bohrpunkte_koo.json')
ZIEL = os.path.join(BASE, 'uploads', 'tables', 'bohrstand.json')

NAMEN = ['Geplant', 'Abgesteckt', 'Gebohrt', 'Pfähle fixiert', 'Injiziert']
STATUS_TXT = {
    'geplant': 0, 'abgesteckt': 1, 'gebohrt': 2,
    'vermessen': 3, 'pfaehle fixiert': 3, 'pfahle fixiert': 3, 'pfähle fixiert': 3,
    'injiziert': 4,
}


def zahl(s):
    """'2,701,853.223' -> 2701853.223"""
    s = (s or '').strip().replace(',', '')
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def datum_von(pfad):
    """Exportdatum aus dem Dateinamen, sonst Aenderungsdatum (ISO-String)."""
    import datetime
    m = re.search(r'(\d{4}-\d{2}-\d{2})', os.path.basename(pfad))
    if m:
        return m.group(1)
    return datetime.date.fromtimestamp(os.path.getmtime(pfad)).isoformat()


def cache_laden():
    if os.path.exists(KOO_CACHE):
        try:
            return json.load(io.open(KOO_CACHE, encoding='utf-8'))
        except ValueError:
            pass
    return {}


def lies_vollexport(pfad, koo, status):
    """DRILLING_POINT_DATA.csv: Koordinaten + Status aus den Datumsfeldern."""
    n = 0
    with io.open(pfad, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            fid = (r.get('FOUNDATION_ID') or '').strip()      # '2186_S1'
            m = re.match(r'^(\S+?)_S([1-4])$', fid)
            if not m:
                continue
            key = m.group(1) + '_S' + m.group(2)
            E = zahl(r.get('IST_O')) or zahl(r.get('SOLL_O'))
            N = zahl(r.get('IST_N')) or zahl(r.get('SOLL_N'))
            H = zahl(r.get('IST_H')) or zahl(r.get('SOLL_H'))
            if E is None or N is None:
                continue
            koo[key] = [round(E, 2), round(N, 2), round(H, 2) if H is not None else None]
            def da(k):
                return bool((r.get(k) or '').strip())
            if da('INJ_DATE'):      st = 4
            elif da('SURVEY_DATE'): st = 3
            elif da('DRILL_DATE'):  st = 2
            elif da('STAK_DATE'):   st = 1
            else:                   st = 0
            try:
                nb = int((r.get('REDRILLS') or '0').strip() or 0)
            except ValueError:
                nb = 0
            status[key] = (st, nb)
            n += 1
    return n


def lies_tagesexport(pfad, status):
    """export-pointId-*.csv: nur Status je Pfahl."""
    n = 0
    with io.open(pfad, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            tid = (r.get('Tisch') or '').strip()
            stz = (r.get('Stütze') or r.get('Stuetze') or '').strip().upper()
            if not tid or not re.match(r'^S[1-4]$', stz):
                continue
            st = STATUS_TXT.get((r.get('Status') or '').strip().lower())
            if st is None:
                continue
            try:
                nb = int((r.get('Nachbohrungen') or '0').strip() or 0)
            except ValueError:
                nb = 0
            status[tid + '_' + stz] = (st, nb)
            n += 1
    return n


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 1

    koo, status, stand = cache_laden(), {}, ''
    # aeltester zuerst -> der neueste Export setzt den Status
    dateien = sorted((p for p in sys.argv[1:] if os.path.exists(p)), key=datum_von)
    for p in sys.argv[1:]:
        if not os.path.exists(p):
            print('  ! fehlt:', p)
    for pfad in dateien:
        name = os.path.basename(pfad)
        with io.open(pfad, encoding='utf-8-sig') as f:
            kopf = f.readline()
        if 'FOUNDATION_ID' in kopf:
            n = lies_vollexport(pfad, koo, status)
            print('  %-34s %5d Bohrpunkte (Koordinaten + Status)' % (name, n))
        else:
            n = lies_tagesexport(pfad, status)
            print('  %-34s %5d Bohrpunkte (nur Status)' % (name, n))
        d = datum_von(pfad)
        if d > stand:
            stand = d

    if not status:
        print('Keine Statusdaten gelesen.'); return 1

    io.open(KOO_CACHE, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(koo, ensure_ascii=False, separators=(',', ':')))

    punkte, summe, ohne = [], [0] * 5, set()
    for key in sorted(status, key=lambda k: (int(k.split('_')[0]) if k.split('_')[0].isdigit() else 0, k)):
        st, nb = status[key]
        k = koo.get(key)
        tid, s = key.rsplit('_S', 1)
        if not k:
            ohne.add(tid); continue
        punkte.append([tid, int(s), k[0], k[1], k[2], st, nb])
        summe[st] += 1

    with io.open(ZIEL, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{"stand":"%s",\n' % stand)
        f.write('"legende":%s,\n' % json.dumps(NAMEN, ensure_ascii=False))
        f.write('"summe":%s,\n' % json.dumps(
            dict((NAMEN[i], summe[i]) for i in range(5)), ensure_ascii=False))
        f.write('"punkte":[\n')
        f.write(',\n'.join(json.dumps(p, ensure_ascii=False, separators=(',', ':')) for p in punkte))
        f.write('\n]}\n')

    print('Bohrstand %s: %d Pfaehle  (%s)' % (
        stand, len(punkte), ', '.join('%s %d' % (NAMEN[i], summe[i]) for i in range(5))))
    if ohne:
        print('   ohne Koordinate: %d Tische (z.B. %s)' % (len(ohne), ', '.join(sorted(ohne)[:8])))
    print('->', ZIEL)
    return 0


if __name__ == '__main__':
    sys.exit(main())
