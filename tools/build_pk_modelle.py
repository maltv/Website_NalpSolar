# -*- coding: utf-8 -*-
r"""IFC-Modelle der Primaerkonstruktionen (Tekla/MAAG) -> Web-Geometrie.

Quelle: NalpSolar_51_PL_035x_A1_MT-3D-Ges-10er-<TYP>_250612.ifc (ILF/MAAG)

Je Typ entstehen drei Stufen, damit Detailansicht und Gelaendekarte je nach
Bedarf laden koennen:

  <typ>_haupt.v.bin/.f.bin   Traeger, Riegel, Bleche  (Detailansicht)
  <typ>_schrauben.v.bin/...  Schrauben/Muttern        (zuschaltbar)
  <typ>_lod.v.bin/.f.bin     nur Traeger+Riegel       (Instanzen im Gelaende)
  <typ>.meta.json            Bounding-Box, Dreieckszahlen, Pfahlpunkte,
                             Bauteilliste (Name -> Anzahl)

Koordinaten: Modell-Meter, Ursprung = Modell-Nullpunkt der IFC, Achsen
X = Tischlaengsachse, Y = Falllinie (bergseits +), Z = Hoehe.
Die vier Pfahlpunkte (Bauteilname "Bohrpfal") stehen in der meta.json und
dienen im Viewer zur Einpassung auf die realen Stuetzenkoordinaten.

Aufruf:  python tools/build_pk_modelle.py <datei1.ifc> [datei2.ifc ...]
"""
import collections
import io
import json
import os
import re
import struct
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(BASE, 'uploads', 'pk')

# Bauteilgruppen -> Stufe. Alles ohne Treffer landet in 'haupt'.
SCHRAUBEN_KLASSEN = ('IfcMechanicalFastener', 'IfcFastener')
LOD_KLASSEN = ('IfcBeam', 'IfcMember')

# Bauteile, die die Modultraeger-Ebene aufspannen. Ihr Mittelpunkt wird zum
# Modell-Nullpunkt – damit sitzt das Modell im Viewer an genau der Stelle, an
# der bisher die Platzhalter-Flaeche lag (Bezug: Mitte Modultraegerflaeche).
REFERENZ_TEILE = ('Träger', 'BLE')


def typ_aus_name(pfad):
    m = re.search(r'10er-([A-E])[_\.]', os.path.basename(pfad))
    return m.group(1) if m else os.path.splitext(os.path.basename(pfad))[0]


def schreibe(basis, verts, faces):
    """verts: Liste [x,y,z] (float), faces: Liste int."""
    with io.open(basis + '.v.bin', 'wb') as f:
        f.write(struct.pack('<%df' % len(verts), *verts))
    with io.open(basis + '.f.bin', 'wb') as f:
        f.write(struct.pack('<%dI' % len(faces), *faces))
    return len(verts) // 3, len(faces) // 3


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 1
    import ifcopenshell
    import ifcopenshell.geom

    os.makedirs(ZIEL, exist_ok=True)
    s = ifcopenshell.geom.settings()
    s.set('use-world-coords', True)
    s.set('weld-vertices', True)

    for pfad in sys.argv[1:]:
        if not os.path.exists(pfad):
            print('  ! fehlt:', pfad); continue
        typ = typ_aus_name(pfad)
        f = ifcopenshell.open(pfad)
        prods = [e for e in f.by_type('IfcProduct') if e.Representation is not None]

        # drei Sammelbehaelter: haupt / schrauben / lod
        buf = {'haupt': ([], []), 'schrauben': ([], []), 'lod': ([], [])}
        teile = collections.Counter()
        pfahl_pkt = []
        mn = [1e18] * 3
        mx = [-1e18] * 3
        rmn = [1e18] * 3        # Bbox der Modultraeger-Ebene (Nullpunkt-Referenz)
        rmx = [-1e18] * 3

        for e in prods:
            try:
                sh = ifcopenshell.geom.create_shape(s, e)
            except Exception:
                continue
            v = list(sh.geometry.verts)
            idx = list(sh.geometry.faces)
            if not v or not idx:
                continue
            name = (getattr(e, 'Name', '') or '').replace('\\S\\d', 'ä')
            teile[name] += 1

            ziele = ['schrauben'] if e.is_a() in SCHRAUBEN_KLASSEN else ['haupt']
            if e.is_a() in LOD_KLASSEN:
                ziele.append('lod')

            for z in ziele:
                vs, fs = buf[z]
                off = len(vs) // 3
                vs.extend(v)
                fs.extend(i + off for i in idx)

            # Bounding-Box + Pfahlpunkte nur aus der Hauptkonstruktion
            if e.is_a() not in SCHRAUBEN_KLASSEN:
                ref = name in REFERENZ_TEILE
                for k in range(0, len(v), 3):
                    for a in range(3):
                        if v[k + a] < mn[a]: mn[a] = v[k + a]
                        if v[k + a] > mx[a]: mx[a] = v[k + a]
                        if ref:
                            if v[k + a] < rmn[a]: rmn[a] = v[k + a]
                            if v[k + a] > rmx[a]: rmx[a] = v[k + a]
            if 'ohrpfal' in name or 'Pfahl' in name:
                xs = v[0::3]; ys = v[1::3]; zs = v[2::3]
                pfahl_pkt.append([round(sum(xs) / len(xs), 3),
                                  round(sum(ys) / len(ys), 3),
                                  round(max(zs), 3)])

        if rmx[0] < rmn[0]:
            print('   ! keine Referenzteile %s gefunden – Modell bleibt unverschoben' % (REFERENZ_TEILE,))
            null = [0.0, 0.0, 0.0]
        else:
            null = [(rmn[a] + rmx[a]) / 2.0 for a in range(3)]   # Mitte Modultraegerflaeche

        meta = {'typ': typ, 'quelle': os.path.basename(pfad),
                'nullpunkt': 'Mitte Modultraegerflaeche (X Laengsachse, +Y talwaerts, Z Hoehe)',
                'bbox': {'min': [round(mn[a] - null[a], 3) for a in range(3)],
                         'max': [round(mx[a] - null[a], 3) for a in range(3)]},
                'modulflaeche': {'laenge': round(rmx[0] - rmn[0], 3),
                                 'breite_hor': round(rmx[1] - rmn[1], 3),
                                 'hoehe': round(rmx[2] - rmn[2], 3)},
                'stufen': {}}
        for z in ('haupt', 'schrauben', 'lod'):
            vs, fs = buf[z]
            if not fs:
                continue
            for k in range(0, len(vs), 3):        # auf den Nullpunkt schieben
                vs[k] -= null[0]; vs[k + 1] -= null[1]; vs[k + 2] -= null[2]
            nv, nf = schreibe(os.path.join(ZIEL, '%s_%s' % (typ, z)), vs, fs)
            meta['stufen'][z] = {'vCount': nv, 'fCount': nf}
        meta['pfaehle'] = [[round(p[a] - null[a], 3) for a in range(3)]
                           for p in zusammenfassen(pfahl_pkt)]
        meta['teile'] = dict(teile.most_common(25))

        with io.open(os.path.join(ZIEL, '%s.meta.json' % typ), 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(meta, fh, ensure_ascii=False, indent=1)
        print('Typ %s: %s' % (typ, ', '.join(
            '%s %d Dreiecke' % (k, v['fCount']) for k, v in meta['stufen'].items())))
        print('   bbox %s .. %s  | %d Pfahlgruppen' % (
            meta['bbox']['min'], meta['bbox']['max'], len(meta['pfaehle'])))
    return 0


def zusammenfassen(punkte, radius=0.6):
    """Pfahl-Teilstuecke zu vier Stuetzenpunkten zusammenfassen."""
    gruppen = []
    for p in punkte:
        for g in gruppen:
            if abs(g[0][0] - p[0]) < radius and abs(g[0][1] - p[1]) < radius:
                g.append(p); break
        else:
            gruppen.append([p])
    aus = []
    for g in gruppen:
        aus.append([round(sum(q[0] for q in g) / len(g), 3),
                    round(sum(q[1] for q in g) / len(g), 3),
                    round(max(q[2] for q in g), 3)])
    return sorted(aus)


if __name__ == '__main__':
    sys.exit(main())
