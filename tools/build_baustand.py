# -*- coding: utf-8 -*-
"""
build_baustand.py – erzeugt uploads/tables/baustand.json fuer den 3D-Baustand:

  uploads/tables/baustand.json          { stand, quelle, tische:{id:{s,pk,mt,vs}} }
      Quelle: Tischexport "export-tableId-*.csv" (api.buildtrack.ch /api/w1/exports/table-id.csv,
      geholt von tools/nalpi_stand_api.py). Nur Tische MIT Datum "Primärkonstruktion montiert".
      s = 'mt' wenn auch "Modulträger montiert", sonst 'pk'.
      vs = Datum "Modultisch verschraubt", falls in Nalpi gesetzt.

Die Koordinaten (uploads/tables/modultische_all.json) baut seit 23.10.2026 NUR noch
tools/build_modultische_api.py aus der Query-Engine des API – der fruehere Weg ueber die
ILF-Belegung-Excels in der Dropbox ist weg (EINE Stelle; dort fehlten 229 Tische aus Bereich 9).
Hier wird die Datei nur gelesen, um gestellte Tische ohne Koordinaten zu melden.

Aufruf (aus Website_NalpSolar):
  python tools/build_baustand.py "<pfad zu export-tableId-JJJJ-MM-TT.csv>"
"""
import csv, io, json, os, re, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def tag_iso(wert):
    """Nalpi-Datum -> 'JJJJ-MM-TT' (Schweizer Tag), leer wenn keins.

    Die Seiten (nalp-sitzung.js, injektion.html, verschrauben.html) rechnen mit dem ISO-Tag.
    Der Grid-Export der Erweiterung und das API (/api/w1/exports/table-id.csv) schreiben
    "25.6.2026"; der alte Edge-Abgriff schrieb den rohen SharePoint-Zeitpunkt
    "2026-06-24T22:00:00Z" - dessen [:10] ist einen Tag zu frueh (Mitternacht Schweizer
    Zeit liegt am Vortag UTC). Beide Formen landen hier auf demselben, richtigen Tag.
    """
    import datetime as dt
    s = (wert or '').strip()
    if not s or s in ('—', '-'):
        return ''
    m = re.match(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})$', s)
    if m:
        return '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1)))
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    try:
        from zoneinfo import ZoneInfo
        roh = dt.datetime.fromisoformat(s[:-1] if s.endswith('Z') else s)
        if roh.tzinfo is None:
            roh = roh.replace(tzinfo=dt.timezone.utc)
        return roh.astimezone(ZoneInfo('Europe/Zurich')).date().isoformat()
    except (ValueError, ImportError):
        return s[:10]


def lese_nalpi(csv_pfad):
    st = {}
    stati = {}
    with io.open(csv_pfad, encoding='utf-8-sig', newline='') as fh:
        for r in csv.DictReader(fh):
            tid = r['Nr.'].strip()
            pk = tag_iso(r.get('Primärkonstruktion montiert', ''))
            mt = tag_iso(r.get('Modulträger montiert', ''))
            # Spalte gibt es erst seit 18.08.2026 – aeltere CSV haben sie nicht
            vs = tag_iso(r.get('Modultisch verschraubt', ''))
            stati[r.get('Baustatus', '?')] = stati.get(r.get('Baustatus', '?'), 0) + 1
            if pk in ('', '—', '-'):
                continue
            e = {'s': 'mt' if mt not in ('', '—', '-') else 'pk', 'pk': pk}
            if e['s'] == 'mt':
                e['mt'] = mt
            if vs not in ('', '—', '-'):
                e['vs'] = vs          # Modultisch verschraubt (Nalpi)
            st[tid] = e
    return st, stati


def main():
    csv_pfad = sys.argv[1] if len(sys.argv) > 1 else None

    koo = os.path.join(BASE, 'uploads', 'tables', 'modultische_all.json')
    alle = {}
    if os.path.exists(koo):
        alle = {str(t[0]).strip(): t for t in json.load(io.open(koo, encoding='utf-8'))}
    else:
        print('  ! %s fehlt - zuerst tools/build_modultische_api.py laufen lassen.' % os.path.basename(koo))

    if not csv_pfad or not os.path.exists(csv_pfad):
        print('Kein Nalpi-Export uebergeben -> baustand.json bleibt unveraendert.')
        return
    stand = os.path.basename(csv_pfad).replace('export-tableId-', '').replace('.csv', '')

    st, stati = lese_nalpi(csv_pfad)
    n_pk = sum(1 for v in st.values() if v['s'] == 'pk')
    n_mt = sum(1 for v in st.values() if v['s'] == 'mt')
    print('Baustand %s: %d gestellt (%d nur PK, %d mit Modultraeger)' % (stand, len(st), n_pk, n_mt))
    fehlen = sorted([t for t in st if t not in alle], key=lambda x: int(x) if x.isdigit() else 0)
    if fehlen:
        print('OHNE Koordinaten (werden im 3D NICHT angezeigt): %d -> %s' % (len(fehlen), ','.join(fehlen)))

    out2 = os.path.join(BASE, 'uploads', 'tables', 'baustand.json')
    io.open(out2, 'w', encoding='utf-8').write(json.dumps(
        {'stand': stand, 'quelle': os.path.basename(csv_pfad), 'tische': st},
        ensure_ascii=False, indent=0))
    print('-> %s' % out2)

if __name__ == '__main__':
    main()
