# -*- coding: utf-8 -*-
"""
build_leitungen.py — alle Werkleitungs-IFC (PZ1/PZ2/PZ3) -> EIN 3D-Viewer-Layer.

Ersetzt tools/ifc-to-leitungen.js (brauchte npm + web-ifc). Liest die
IFC4X3-Dateien von ILF direkt: die Rohre/Schaechte stecken als
IFCTRIANGULATEDFACESET + IFCCARTESIANPOINTLIST3D in IFCBUILTELEMENT,
Placement ist reine Verschiebung (keine Rotation, gegen alle Dateien geprueft).

Ausgabe (uploads/ifc/leitungen.*):
  .v.bin    Float32  Positionen im Frame [East-OE, North-ON, Elev-OZ]
  .f.bin    Uint32   Dreiecks-Indizes
  .e.bin    Uint16   Strang-Index je Vertex  -> Klick-Highlight im Viewer
  .meta.json         { elemIds, vCount, fCount, legend, straenge[] }

Die Farben kommen NICHT mehr als .c.bin (waren 3.5 MB fuer 5 Farbwerte),
sondern baut der Viewer aus straenge[i].k + legend.

straenge[i] = { n:Name, k:Kategorie, q:Quelle(PZ), l:Laenge_m,
                a:[x,y,z] Anfang, b:[x,y,z] Ende, m:[x,y,z] Mitte,
                p:[[x,y,z], ...] vereinfachte Achse (Verlaufslinie im Viewer) }
(Koordinaten im gleichen Frame wie .v.bin)

Aufruf:  python tools/build_leitungen.py
"""
import json, math, os, re, struct, sys

# LV95-Ursprung des 3D-Viewers (viewer3d.html: OE/ON/OZ)
OE, ON, OZ = 2701555, 1165641, 1950

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DBX = (r"C:\Users\MaltVic\STRABAG SE Dropbox\CH-MX-EE-Projekte\EE-RK-240 AUSF"
       r"\EE-RKDO_2400024369_NalpSolar\07 Plaene-Gutachten-Statik\01 Plane Ablage"
       "\\Ausf\u00fchrungspl\u00e4ne\\Werkleitungen")

# Quelle -> (Pfad, Kurzbezeichnung fuer die Info-Box)
QUELLEN = [
    (DBX + r"\FVPZ1\NalpSolar_51_M_0460_A2_TB-2026-PZ1-WL.ifc",  "PZ1"),
    (DBX + r"\FVPZ2\NalpSolar_51_M_0468_A2_TB-2026-PZ2-WL.ifc",  "PZ2"),
    (DBX + r"\FVPZ2\NalpSolar_51_M_0465_A1_TB-2026-PZ2-HRB.ifc", "PZ2"),
    (REPO + r"\uploads\ifc\NalpSolar_51_M_0472_A1_TB-2027-PZ3-HRB.ifc", "PZ3"),
    (DBX + r"\FVPZ3\NalpSolar_51_M_0475_A1_TB-2027-PZ3-WL.ifc",  "PZ3"),
]

# Kategorie -> Farbe (RGB 0..1) + Legende. Muss zur Legende in viewer3d.html passen.
CATS = {
    "60":      {"col": [0.16, 0.80, 0.45], "label": "KSR DN60 (Feinverteilung)"},
    "120":     {"col": [1.00, 0.30, 0.30], "label": "KSR DN120"},
    "hrb":     {"col": [0.12, 0.58, 0.95], "label": "HRB (Haupttrasse)"},
    "schacht": {"col": [0.80, 0.80, 0.80], "label": "Schacht"},
    "other":   {"col": [0.90, 0.75, 0.20], "label": "Sonstige"},
}


def classify(name):
    n = (name or "").upper()
    if "SCHACHT" in n:
        return "schacht"
    if "HRB" in n:
        return "hrb"
    if "120" in n:
        return "120"
    if "60" in n:
        return "60"
    return "other"


# ── minimaler STEP/IFC-Parser ────────────────────────────────────────────────
def step_entities(pfad):
    """{id: (TYP, argstring)} aus dem DATA-Abschnitt."""
    txt = open(pfad, "r", encoding="utf-8", errors="replace").read()
    txt = txt[txt.index("DATA;") + 5:]
    ents, i, n = {}, 0, len(txt)
    while i < n:
        j = txt.find("#", i)
        if j < 0:
            break
        m = re.match(r"#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(", txt[j:j + 120])
        if not m:
            i = j + 1
            continue
        eid, typ = int(m.group(1)), m.group(2).upper()
        k = j + m.end()          # hinter der oeffnenden Klammer
        depth, instr, esc = 1, False, False
        while k < n and depth:
            c = txt[k]
            if instr:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == "'":
                    instr = False
            elif c == "'":
                instr = True
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            k += 1
        ents[eid] = (typ, txt[j + m.end():k - 1])
        i = k
    return ents


def split_args(s):
    """Argumentliste einer Entity auf oberster Klammerebene zerlegen."""
    out, depth, buf, instr, esc = [], 0, [], False, False
    for c in s:
        if instr:
            buf.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == "'":
                instr = False
            continue
        if c == "'":
            instr = True; buf.append(c); continue
        if c == "(":
            depth += 1; buf.append(c); continue
        if c == ")":
            depth -= 1; buf.append(c); continue
        if c == "," and depth == 0:
            out.append("".join(buf).strip()); buf = []; continue
        buf.append(c)
    out.append("".join(buf).strip())
    return out


def ref(a):
    return int(a[1:]) if a.startswith("#") else None


def punkte_liste(s):
    """'((x,y,z),(x,y,z),...)' -> [(x,y,z), ...]"""
    return [tuple(float(v) for v in g.split(","))
            for g in re.findall(r"\(([^()]*)\)", s)]


def dreiecke(s):
    return [(int(a), int(b), int(c))
            for a, b, c in re.findall(r"\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", s)]


def flaechen_je_element(ents):
    """{element_id: {'Area': float, 'Typ': str}} aus den IfcPropertySets."""
    werte = {}
    for eid, (typ, args) in ents.items():
        if typ != "IFCPROPERTYSET":
            continue
        a = split_args(args)
        if len(a) < 5:
            continue
        for pid in re.findall(r"#(\d+)", a[4]):
            pt, pa = ents.get(int(pid), ("", ""))
            if pt != "IFCPROPERTYSINGLEVALUE":
                continue
            p = split_args(pa)
            nm = p[0].strip("'")
            if nm == "Area":
                m = re.search(r"\(([-0-9.eE+]+)\)", p[2])
                if m:
                    werte.setdefault(eid, {})["Area"] = float(m.group(1))
            elif nm == "Typ":
                m = re.search(r"\('(.*)'\)", p[2])
                if m:
                    werte.setdefault(eid, {})["Typ"] = m.group(1)
    # PropertySet -> Elemente (ein Element haengt an mehreren Sets)
    out = {}
    for eid, (typ, args) in ents.items():
        if typ != "IFCRELDEFINESBYPROPERTIES":
            continue
        a = split_args(args)
        if len(a) < 6:
            continue
        psid = ref(a[5])
        if psid not in werte:
            continue
        for o in re.findall(r"#(\d+)", a[4]):
            out.setdefault(int(o), {}).update(werte[psid])
    return out


def placement_offset(ents, pid):
    """IFCLOCALPLACEMENT-Kette zu einer reinen Verschiebung aufsummieren."""
    dx = dy = dz = 0.0
    while pid:
        typ, args = ents.get(pid, (None, None))
        if typ != "IFCLOCALPLACEMENT":
            break
        a = split_args(args)
        rel = ref(a[1]) if len(a) > 1 else None
        if rel and ents.get(rel, ("",))[0] == "IFCAXIS2PLACEMENT3D":
            aa = split_args(ents[rel][1])
            if len(aa) > 1 and aa[1] not in ("$", "*"):
                sys.stderr.write("WARNUNG: Placement #%d hat eine Achse (Rotation) "
                                 "- wird ignoriert\n" % rel)
            p = ref(aa[0])
            if p and ents.get(p, ("",))[0] == "IFCCARTESIANPOINT":
                c = punkte_liste("(" + ents[p][1] + ")")
                if c:
                    v = c[0]
                    dx += v[0]; dy += v[1]; dz += v[2] if len(v) > 2 else 0.0
        pid = ref(a[0]) if a[0].startswith("#") else None
    return dx, dy, dz


def achse(pts, tris):
    """Rohrachse als Stuetzpunktfolge fuer die Verlaufslinie im Viewer.

    ACHTUNG: Die Punktlisten von Civil3D laufen NICHT ringweise, sondern
    spaltenweise entlang der Rohrachse (aufeinanderfolgende Punkte liegen in
    benachbarten Querschnitten, nicht im selben). Eine Ringgruppierung liefert
    darum Unsinn (geprueft 12.08.2026 am PZ3-Modell).

    Robuster Weg ohne Annahme ueber die Reihenfolge: die Punkte auf die
    Verbindung der beiden Rohrenden projizieren, in Scheiben schneiden und je
    Scheibe den Schwerpunkt nehmen. Fuer die reine Darstellung genuegt das
    auch bei gekruemmten Rohren.

    Die LAENGE kommt NICHT von hier, sondern aus der IFC-Eigenschaft `Area`
    (siehe laenge_aus_area) - das ist die im Ausmass etablierte und gegen die
    Geometrie gepruefte Methode.
    """
    n = len(pts)
    if n < 4:
        return list(pts[:2]), 0.0
    c = (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n, sum(p[2] for p in pts) / n)
    a = max(pts, key=lambda p: (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2)
    b = max(pts, key=lambda p: (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2)
    d = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    span = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
    if span < 1e-6:
        return [a, b], 0.0
    d = (d[0] / span, d[1] / span, d[2] / span)
    scheiben = max(2, min(60, int(span / 1.5) + 1))
    eimer = [[] for _ in range(scheiben)]
    for p in pts:
        t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / span
        eimer[min(scheiben - 1, max(0, int(t * scheiben)))].append(p)
    mids = [(sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g),
             sum(p[2] for p in g) / len(g)) for g in eimer if g]
    zug = sum(math.dist(mids[i], mids[i - 1]) for i in range(1, len(mids)))
    return mids, zug


def laenge_aus_area(info):
    """Rohrlaenge = Mantelflaeche / (pi * Aussendurchmesser).

    Gegen die Geometrie validiert (12.08.2026): bei den geraden Rohren des
    PZ3-Modells deckt sich das Ergebnis auf 0-4 % mit der Bounding-Box-
    Diagonale. Gleiche Methode wie im Ausmass-Auszug Plika/KSR.

    NUR fuer Einzelrohre. Die HRB-Bauteile sind Buendel (Typ z.B.
    '21 x KSR DN120/132 + 1 x KSR DN60/72') - dort ist die Flaeche die
    Oberflaeche des ganzen Rohrblocks, die Formel gaebe Unsinn. In dem Fall
    None zurueckgeben, der Aufrufer nimmt dann den Achsenzug.
    """
    if not info:
        return None
    od = {"KSR DN 60/72": 0.072, "KSR DN 120/132": 0.132}.get((info.get("Typ") or "").strip())
    area = info.get("Area")
    if not od or not area:
        return None
    return area / (math.pi * od)


def vereinfachen(pts, tol=0.25):
    """Douglas-Peucker: Achse auf wenige Stuetzpunkte fuer die Verlaufslinie."""
    if len(pts) < 3:
        return list(pts)
    a, b = pts[0], pts[-1]
    ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    lab2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
    imax, dmax = 0, -1.0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        ap = (p[0] - a[0], p[1] - a[1], p[2] - a[2])
        t = 0.0 if lab2 == 0 else max(0.0, min(1.0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / lab2))
        d = math.dist(p, (a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t))
        if d > dmax:
            imax, dmax = i, d
    if dmax <= tol:
        return [a, b]
    return vereinfachen(pts[:imax + 1], tol)[:-1] + vereinfachen(pts[imax:], tol)


# ── Hauptlauf ───────────────────────────────────────────────────────────────
def main():
    out_base = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "uploads", "ifc", "leitungen")
    positions, elem_of_v, indices, straenge = [], [], [], []
    vmap = {}
    catcount = {}

    for pfad, quelle in QUELLEN:
        if not os.path.exists(pfad):
            sys.stderr.write("FEHLT (uebersprungen): %s\n" % pfad)
            continue
        ents = step_entities(pfad)
        flaechen = flaechen_je_element(ents)
        # Geometrie je BuiltElement einsammeln
        n_el = 0
        for eid, (typ, args) in ents.items():
            if typ != "IFCBUILTELEMENT":
                continue
            a = split_args(args)
            name = a[2].strip("'") if len(a) > 2 and a[2] != "$" else ""
            kat = classify(name)
            dx, dy, dz = placement_offset(ents, ref(a[5]) if len(a) > 5 else None)

            # Repraesentation -> TriangulatedFaceSet
            pdsid = ref(a[6]) if len(a) > 6 else None
            if not pdsid or ents.get(pdsid, ("",))[0] != "IFCPRODUCTDEFINITIONSHAPE":
                continue
            reps = []
            for r in re.findall(r"#(\d+)", split_args(ents[pdsid][1])[2]):
                rt, ra = ents.get(int(r), ("", ""))
                if rt == "IFCSHAPEREPRESENTATION":
                    reps += [int(x) for x in re.findall(r"#(\d+)", split_args(ra)[3])]

            el_pts, el_tris = [], []
            for it in reps:
                it_t, it_a = ents.get(it, ("", ""))
                if it_t != "IFCTRIANGULATEDFACESET":
                    continue
                ia = split_args(it_a)
                plid = ref(ia[0])
                if not plid or ents.get(plid, ("",))[0] != "IFCCARTESIANPOINTLIST3D":
                    continue
                pts = punkte_liste(split_args(ents[plid][1])[0])
                tris = dreiecke(ia[3]) if len(ia) > 3 else []
                base = len(el_pts)
                el_pts += [(p[0] + dx, p[1] + dy, p[2] + dz) for p in pts]
                el_tris += [(t[0] + base, t[1] + base, t[2] + base) for t in tris]
            if not el_pts or not el_tris:
                continue

            si = len(straenge)              # Strang-Index fuer das Highlight
            lokal = []
            for p in el_pts:
                x, y, z = p[0] - OE, p[1] - ON, p[2] - OZ
                key = (round(x, 4), round(y, 4), round(z, 4), si)
                idx = vmap.get(key)
                if idx is None:
                    idx = len(positions) // 3
                    positions += [x, y, z]
                    elem_of_v.append(si)
                    vmap[key] = idx
                lokal.append(idx)
            for t in el_tris:               # IFC-Indizes sind 1-basiert
                try:
                    indices += [lokal[t[0] - 1], lokal[t[1] - 1], lokal[t[2] - 1]]
                except IndexError:
                    pass

            mids, zug = achse([(p[0] - OE, p[1] - ON, p[2] - OZ) for p in el_pts], el_tris)
            # Laenge bevorzugt aus der Mantelflaeche (validiert), sonst Achsenzug
            laenge = laenge_aus_area(flaechen.get(eid))
            if laenge is None:
                laenge = zug
            xs = [p[0] - OE for p in el_pts]; ys = [p[1] - ON for p in el_pts]; zs = [p[2] - OZ for p in el_pts]
            poly = vereinfachen(mids) if len(mids) > 1 else mids
            straenge.append({
                "n": name, "k": kat, "q": quelle, "l": round(laenge, 1),
                "a": [round(v, 2) for v in mids[0]] if mids else None,
                "b": [round(v, 2) for v in mids[-1]] if mids else None,
                "m": [round((min(xs) + max(xs)) / 2, 2),
                      round((min(ys) + max(ys)) / 2, 2),
                      round((min(zs) + max(zs)) / 2, 2)],
                "p": [[round(v, 2) for v in q] for q in poly],
            })
            c = catcount.setdefault(kat, {"elems": 0, "tris": 0, "len": 0.0})
            c["elems"] += 1; c["tris"] += len(el_tris); c["len"] += laenge
            n_el += 1
        print("  %-4s %-52s %3d Straenge" % (quelle, os.path.basename(pfad), n_el))

    v_count, f_count = len(positions) // 3, len(indices) // 3
    if len(straenge) > 65535:
        sys.exit("Mehr als 65535 Straenge - .e.bin muesste Uint32 werden")

    with open(out_base + ".v.bin", "wb") as f:
        f.write(struct.pack("<%df" % len(positions), *positions))
    with open(out_base + ".f.bin", "wb") as f:
        f.write(struct.pack("<%dI" % len(indices), *indices))
    with open(out_base + ".e.bin", "wb") as f:
        f.write(struct.pack("<%dH" % len(elem_of_v), *elem_of_v))
    # altes .c.bin aus frueheren Laeufen wegraeumen (Farben kommen jetzt aus meta)
    if os.path.exists(out_base + ".c.bin"):
        os.remove(out_base + ".c.bin")

    legend = [{"key": k, "label": CATS[k]["label"], "color": CATS[k]["col"],
               "elems": v["elems"], "tris": v["tris"], "len": round(v["len"])}
              for k, v in catcount.items()]
    meta = {"elemIds": True, "vCount": v_count, "fCount": f_count,
            "legend": legend, "labels": [], "straenge": straenge}
    with open(out_base + ".meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print("\nOK -> %s.{v,f,e}.bin + .meta.json" % out_base)
    print("  %d Vertices, %d Dreiecke, %d Straenge" % (v_count, f_count, len(straenge)))
    for l in legend:
        print("  %-10s %4d Straenge  %7d Dreiecke  ~%5d m" % (l["key"], l["elems"], l["tris"], l["len"]))


if __name__ == "__main__":
    main()
