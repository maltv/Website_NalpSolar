# -*- coding: utf-8 -*-
"""Plansatz Transport-Ladegestell NalpSolar: Knieträger / Quertraversen.
A3 quer, 4 Blätter, Ausgabe als ein PDF."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Polygon, Circle, FancyArrow
from matplotlib.backends.backend_pdf import PdfPages
import matplotlib.patches as mpatches
import numpy as np

A3 = (16.54, 11.69)  # inch
INK = '#1a2430'; DIM = '#5b6b7c'; RED = '#c22026'; BLU = '#2a5fa8'; GRN = '#2e7d32'
STEEL = '#c9d2dc'; WOOD = '#caa06a'; LOADQ = '#e8a012'; LOADK = '#8bd450'

def sheet(pdf, blatt, titel, untertitel):
    fig = plt.figure(figsize=A3)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 420); ax.set_ylim(0, 297)
    ax.axis('off')
    ax.add_patch(Rectangle((8, 8), 404, 281, fill=False, ec=INK, lw=1.4))
    # Schriftfeld
    ax.add_patch(Rectangle((252, 8), 160, 34, fill=False, ec=INK, lw=1.1))
    for yy in (19.5, 30.5):
        ax.plot([252, 412], [yy, yy], color=INK, lw=0.5)
    ax.plot([322, 322], [8, 42], color=INK, lw=0.5)
    ax.text(255, 36.5, 'NalpSolar – Transportlogistik Stahlbau', fontsize=7.5, color=INK, fontweight='bold')
    ax.text(255, 33.0, 'Anhänger-Ladegestell (Unterkonstruktion)', fontsize=6.4, color=INK)
    ax.text(255, 26.5, titel, fontsize=8, color=INK, fontweight='bold')
    ax.text(255, 22.5, untertitel, fontsize=5.8, color=DIM)
    ax.text(325, 26.5, f'Blatt {blatt} / 4', fontsize=9, color=INK, fontweight='bold')
    ax.text(325, 22.5, 'A3 · Masse in mm', fontsize=6.2, color=DIM)
    ax.text(255, 16.0, 'Gezeichnet: Claude (KI) · 29.07.2026', fontsize=6.2, color=DIM)
    ax.text(255, 12.0, 'Quelle: Mauchle 24027-S-0-M-006…010 Rev B', fontsize=6.2, color=DIM)
    ax.text(325, 36.5, 'Axpo Solutions AG', fontsize=6.4, color=INK)
    ax.text(325, 33.0, 'Baustelle Nalps', fontsize=6.4, color=INK)
    ax.text(325, 16.0, 'VORABZUG', fontsize=10, color=RED, fontweight='bold')
    ax.text(325, 11.5, 'zur Bewilligungseingabe', fontsize=6.2, color=RED)
    # Vorbehalt
    ax.add_patch(Rectangle((12, 8), 236, 16, fill=False, ec=RED, lw=1.0))
    ax.text(15, 19.5, 'VOR AUSFÜHRUNG ZWINGEND:', fontsize=6.4, color=RED, fontweight='bold')
    ax.text(15, 15.7, 'Statischer Nachweis Ladegestell + Ladungssicherung durch Fachperson · Eignung/Zulassung des Basisanhängers prüfen (Fahrzeugausweis, Nutzlast, Stützlast)',
            fontsize=5.6, color=INK)
    ax.text(15, 11.9, 'Hüllmasse der Knieträger vor Fertigung an einem vormontierten Stück nachmessen (mit * markierte Masse = aus Plänen abgeleitete Annahmen)',
            fontsize=5.6, color=INK)
    return fig, ax

def dim_h(ax, x1, x2, y, txt, s=1.0, off=0, fs=5.8, col=DIM):
    ax.annotate('', xy=(x1, y), xytext=(x2, y), arrowprops=dict(arrowstyle='<|-|>', color=col, lw=0.7, mutation_scale=8))
    ax.plot([x1, x1], [y - 2*s, y + 2*s], color=col, lw=0.6)
    ax.plot([x2, x2], [y - 2*s, y + 2*s], color=col, lw=0.6)
    ax.text((x1 + x2)/2, y + 1.4 + off, txt, fontsize=fs, color=col, ha='center')

def dim_v(ax, y1, y2, x, txt, fs=5.8, col=DIM, rot=90, dx=-1.6):
    ax.annotate('', xy=(x, y1), xytext=(x, y2), arrowprops=dict(arrowstyle='<|-|>', color=col, lw=0.7, mutation_scale=8))
    ax.plot([x - 2, x + 2], [y1, y1], color=col, lw=0.6)
    ax.plot([x - 2, x + 2], [y2, y2], color=col, lw=0.6)
    ax.text(x + dx, (y1 + y2)/2, txt, fontsize=fs, color=col, va='center', ha='center', rotation=rot)

def note(ax, x, y, lines, fs=6.0, title=None, w=None, col=INK):
    if title:
        ax.text(x, y, title, fontsize=fs + 1, color=col, fontweight='bold'); y -= fs*0.75
    for l in lines:
        ax.text(x, y, l, fontsize=fs, color=col); y -= fs*0.72
    return y

# Geometrie Basis (mm): Brücke 4500x2100, Joche bei 300/2250/4200
BED_L, BED_W = 4500, 2100
JOCH_X = [300, 2250, 4200]

def draw_grundgestell_seite(ax, ox, oy, sc, abock=False):
    """Seitenansicht Anhänger + Gestell. sc = mm -> Zeichnungseinheit"""
    def X(v): return ox + v*sc
    def Y(v): return oy + v*sc
    # Räder Tandem
    for wx in (1750, 2750):
        ax.add_patch(Circle((X(wx), Y(-450)), 350*sc, fill=False, ec=INK, lw=1.1))
        ax.add_patch(Circle((X(wx), Y(-450)), 180*sc, fill=False, ec=DIM, lw=0.6))
    # Brücke
    ax.add_patch(Rectangle((X(0), Y(-120)), BED_L*sc, 120*sc, fc='#e8ecf1', ec=INK, lw=1.1))
    # Deichsel
    ax.plot([X(0), X(-1300)], [Y(-60), Y(-260)], color=INK, lw=2.2)
    ax.add_patch(Circle((X(-1350), Y(-270)), 45*sc, fill=False, ec=INK, lw=1.1))
    # Joche (UNP140 quer, Ansicht = Profilquerschnitt) + Hartholz
    for jx in JOCH_X:
        ax.add_patch(Rectangle((X(jx-70), Y(0)), 140*sc, 140*sc, fc=STEEL, ec=INK, lw=0.9))
        ax.add_patch(Rectangle((X(jx-70), Y(140)), 140*sc, 60*sc, fc=WOOD, ec=INK, lw=0.7))
    # Längsholme
    ax.add_patch(Rectangle((X(260), Y(50)), (4240-260)*sc, 40*sc, fc='none', ec=DIM, lw=0.7, ls='--'))
    if abock:
        ax.plot([X(2250-900), X(2250)], [Y(200), Y(2500)], color=BLU, lw=1.6)
        ax.plot([X(2250+900), X(2250)], [Y(200), Y(2500)], color=BLU, lw=1.6)
        ax.plot([X(2250-450), X(2250+450)], [Y(1350), Y(1350)], color=BLU, lw=1.2)
        ax.plot([X(300), X(4200)], [Y(2500), Y(2500)], color=BLU, lw=1.6)  # Firstholm
        for jx in (300, 4200):
            ax.plot([X(jx-300), X(jx)], [Y(200), Y(2500)], color=BLU, lw=1.3)
            ax.plot([X(jx+300), X(jx)], [Y(200), Y(2500)], color=BLU, lw=1.3)
    return X, Y

# Knieträger-Kontur (Typ A*): Auflagerträger 3900* liegend, Stütze 3655 unter 120°
# Innenwinkel. Liegend auf dem Auflagerträger ragt nichts unter die Auflage-Ebene.
def knie_poly(sc=1.0):
    at_l, at_b = 3900, 120        # Auflagerträger horizontal, UK = y=0
    st_l, st_b = 3655, 160
    jx = 900                      # Knoten: 900 ab unterem Trägerende
    ang = np.deg2rad(120)         # Stütze 120° zur Trägerachse (nach links oben)
    c, s = np.cos(ang), np.sin(ang)
    p_at = [(0, 0), (at_l, 0), (at_l, at_b), (0, at_b)]
    def rot(px, py):
        return (jx + px*c - py*s, at_b/2 + px*s + py*c)
    p_st = [rot(0, -st_b/2), rot(st_l, -st_b/2), rot(st_l, st_b/2), rot(0, st_b/2)]
    polys = [p_at, p_st]
    xs = [x for p in polys for x, _ in p]; ys = [y for p in polys for _, y in p]
    x0, y0 = min(xs), min(ys)
    out = [[((x - x0)*sc, (y - y0)*sc) for x, y in p] for p in polys]
    bbox = ((max(xs) - x0), (max(ys) - y0))
    return out, bbox

with PdfPages('/home/user/Website_NalpSolar/transport/Ladegestell_Knietraeger_Quertraversen.pdf') as pdf:

    # ---------------- BLATT 1: Übersicht Grundgestell ----------------
    fig, ax = sheet(pdf, 1, 'Ladegestell – Übersicht & Stückliste',
                    'Grundgestell für beide Varianten · A-Bock steckbar')
    sc = 0.030
    # Seitenansicht
    X, Y = draw_grundgestell_seite(ax, 40, 60, sc, abock=True)
    ax.text(40, 178, 'Seitenansicht 1:33 (mit gestecktem A-Bock)', fontsize=7.5, fontweight='bold', color=INK)
    dim_h(ax, X(0), X(BED_L), Y(-120) - 14, 'Brücke 4500 (Anforderung ≥ 4300)')
    dim_h(ax, X(JOCH_X[0]), X(JOCH_X[1]), Y(200) + 8, '1950')
    dim_h(ax, X(JOCH_X[1]), X(JOCH_X[2]), Y(200) + 8, '1950')
    dim_v(ax, Y(0), Y(200), X(4200) + 14, '200', dx=2.2)
    dim_v(ax, Y(200), Y(2500), X(4200) + 26, 'A-Bock 2300', dx=3.0)
    ax.text(X(2250), Y(2620), 'Firstholm RRK80×80×4, L=3900', fontsize=5.8, color=BLU, ha='center')
    ax.text(X(-500), Y(-950), 'Zugöse/Kupplung nach Basisfzg.', fontsize=5.4, color=DIM, ha='left')
    ax.annotate('Joch UNP140 + Hartholz 60', xy=(X(4200), Y(170)), xytext=(X(4700), Y(800)),
                fontsize=5.8, color=INK, arrowprops=dict(arrowstyle='->', color=DIM, lw=0.7))
    ax.annotate('A-Bock-Strebe\nRRK60×60×4', xy=(X(1600), Y(1700)), xytext=(X(400), Y(2100)),
                fontsize=5.8, color=BLU, arrowprops=dict(arrowstyle='->', color=BLU, lw=0.7))

    # Draufsicht (ohne A-Bock)
    oy2 = 196; ox2 = 40; sc2 = 0.030
    def X2(v): return ox2 + v*sc2
    def Y2(v): return oy2 + v*sc2
    ax.text(40, 275, 'Draufsicht Grundgestell 1:33 (ohne A-Bock)', fontsize=7.5, fontweight='bold', color=INK)
    ax.add_patch(Rectangle((X2(0), Y2(0)), BED_L*sc2, BED_W*sc2, fc='none', ec=INK, lw=1.0))
    for jx in JOCH_X:
        ax.add_patch(Rectangle((X2(jx-70), Y2(0)), 140*sc2, BED_W*sc2, fc=STEEL, ec=INK, lw=0.8))
        for ry in (0, BED_W-70):
            ax.add_patch(Rectangle((X2(jx-35), Y2(ry)), 70*sc2, 70*sc2, fc=BLU, ec=INK, lw=0.8))
    for hy in (525, 1575):
        ax.add_patch(Rectangle((X2(260), Y2(hy-40)), (4240-260)*sc2, 80*sc2, fc='none', ec=DIM, lw=0.8, ls='--'))
    # Zurrpunkte
    for jx in (300, 2250, 4200):
        for ry in (180, BED_W-180):
            ax.add_patch(Circle((X2(jx), Y2(ry)), 2.0, fill=False, ec=RED, lw=1.0))
            ax.plot([X2(jx)-1.4, X2(jx)+1.4], [Y2(ry)-1.4, Y2(ry)+1.4], color=RED, lw=0.8)
    dim_h(ax, X2(0), X2(BED_L), Y2(BED_W) + 10, '4500')
    dim_v(ax, Y2(0), Y2(BED_W), X2(0) - 12, '2100')
    dim_v(ax, Y2(70), Y2(BED_W-70), X2(0) - 24, 'lichte Weite Rungen 1960', dx=-3.0)
    ax.annotate('Runge RRK70×70×5, h=900,\nsteckbar (6×)', xy=(X2(2250), Y2(BED_W-35)), xytext=(X2(4750), Y2(1550)),
                fontsize=5.8, color=BLU, arrowprops=dict(arrowstyle='->', color=BLU, lw=0.7))
    ax.annotate('Zurrpunkt 2000 daN (6×)', xy=(X2(4200), Y2(180)), xytext=(X2(4750), Y2(300)),
                fontsize=5.8, color=RED, arrowprops=dict(arrowstyle='->', color=RED, lw=0.7))
    ax.annotate('Längsholm RRK80×80×4 (2×),\nverschraubt auf Jochen', xy=(X2(1300), Y2(525)), xytext=(X2(4750), Y2(850)),
                fontsize=5.8, color=DIM, arrowprops=dict(arrowstyle='->', color=DIM, lw=0.7))

    # Stückliste
    tx = 250; ty = 272
    ax.text(tx, ty, 'Stückliste Ladegestell (S355J2, roh / feuerverzinkt empfohlen)', fontsize=7.5, fontweight='bold', color=INK)
    rows = [
        ('Pos', 'Stk', 'Bauteil', 'Profil / Mass', '≈ kg'),
        ('1', '3', 'Auflagerjoch, quer', 'UNP140, L=2100', '3×34'),
        ('2', '6', 'Runge, steckbar', 'RRK70×70×5, h=900', '6×9'),
        ('3', '6', 'Rungentasche, geschweisst', 'RRK80×80×5, h=200', '6×3'),
        ('4', '2', 'Längsholm', 'RRK80×80×4, L=3940', '2×36'),
        ('5', '3', 'Hartholz-Auflage (Buche)', '100×60, L=2100', '3×9'),
        ('6', '1', 'A-Bock steckbar (2 Böcke + First)', 'RRK60×60×4 / RRK80×80×4', '92'),
        ('7', '6', 'Zurrpunkt geschraubt', 'Zurröse 2000 daN', '–'),
        ('8', '12', 'Befestigung Joch–Brücke', 'M16×… 8.8 (je Joch 4×)', '–'),
    ]
    for i, r in enumerate(rows):
        yy = ty - 6 - i*5.4
        fw = 'bold' if i == 0 else 'normal'
        for xx, v in zip((tx, tx+14, tx+26, tx+92, tx+148), r):
            ax.text(xx, yy, v, fontsize=6.0, color=INK, fontweight=fw)
    ax.text(tx, ty - 6 - len(rows)*5.4, 'Eigengewicht Ladegestell inkl. A-Bock ≈ 290 kg', fontsize=6.4, color=INK, fontweight='bold')

    note(ax, 250, 200, [
        '• Basisfahrzeug (bauartgeprüft, eingelöst): Plattform-/Tandemanhänger,',
        '   Brücke ≥ 4300×2050, Nutzlast ≥ 3.0 t, zul. Stützlast beachten.',
        '• Ladegestell wird mit 12× M16 durch die Brücke verschraubt',
        '   (Unterlagsplatten 60×60×6 unter der Brücke).',
        '• Lastschwerpunkt jeder Beladung über dem Achsaggregat halten;',
        '   Stützlast 4–10 % des Anhängergewichts.',
        '• Alle Schweissnähte a=4 umlaufend, Ausführungsklasse EXC2 (EN 1090).',
    ], fs=6.0, title='Hinweise')
    pdf.savefig(fig); plt.close(fig)

    # ---------------- BLATT 2: Variante Q – Quertraversen ----------------
    fig, ax = sheet(pdf, 2, 'Variante Q – Quertraversen (Riegel) flach',
                    'Riegel ≤ 7620 mm · ohne A-Bock · Überhang markieren')
    sc = 0.026
    X, Y = draw_grundgestell_seite(ax, 70, 70, sc, abock=False)
    ax.text(40, 190, 'Seitenansicht 1:38', fontsize=7.5, fontweight='bold', color=INK)
    # Rungen in Seitenansicht
    for jx in JOCH_X:
        ax.add_patch(Rectangle((X(jx-35), Y(200)), 70*sc, 900*sc, fc=BLU, ec=INK, lw=0.8, alpha=0.85))
    # Riegel: 2 Lagen, 7620 zentriert auf Joche (Mitte 2250)
    rg_l = 7620; x0 = 2250 - rg_l/2
    for lay in range(2):
        yb = 200 + lay*(250+60)
        ax.add_patch(Rectangle((X(x0), Y(yb)), rg_l*sc, 250*sc, fc=LOADQ, ec=INK, lw=0.9, alpha=0.9))
        if lay == 0:
            for jx in JOCH_X:
                pass
        else:
            for jx in JOCH_X:
                ax.add_patch(Rectangle((X(jx-50), Y(200+250)), 100*sc, 60*sc, fc=WOOD, ec=INK, lw=0.6))
    dim_h(ax, X(x0), X(x0+rg_l), Y(200+560) + 10, 'Riegel ≤ 7620 (Typ E: 7614 über alles)')
    dim_h(ax, X(x0), X(0), Y(-120) - 14, 'Überhang vorne ≈ 1560', col=RED)
    dim_h(ax, X(BED_L), X(x0+rg_l), Y(-120) - 14, 'Überhang hinten ≈ 1560', col=RED)
    ax.annotate('Markierung Überhang:\nSignalfahne/-tafel (VRV Art. 73)', xy=(X(x0+rg_l), Y(330)),
                xytext=(X(x0+rg_l-900), Y(1500)), fontsize=6.0, color=RED,
                arrowprops=dict(arrowstyle='->', color=RED, lw=0.8))
    ax.annotate('Freiraum über Deichsel ≥ 300\n(Kurvenlauf prüfen!)', xy=(X(x0+400), Y(180)),
                xytext=(X(x0-300), Y(1500)), fontsize=6.0, color=INK,
                arrowprops=dict(arrowstyle='->', color=DIM, lw=0.7))

    # Querschnitt
    ox3, oy3 = 300, 70; sc3 = 0.040
    def X3(v): return ox3 + v*sc3
    def Y3(v): return oy3 + v*sc3
    ax.text(285, 190, 'Querschnitt Bündel 1:25 (Beispiel Typ E, RRK250×250)', fontsize=7.5, fontweight='bold', color=INK)
    ax.add_patch(Rectangle((X3(-1050), Y3(-120)), 2100*sc3, 120*sc3, fc='#e8ecf1', ec=INK, lw=1.0))
    ax.add_patch(Rectangle((X3(-1050), Y3(0)), 2100*sc3, 140*sc3, fc=STEEL, ec=INK, lw=0.9))
    ax.add_patch(Rectangle((X3(-1050), Y3(140)), 2100*sc3, 60*sc3, fc=WOOD, ec=INK, lw=0.7))
    ax.add_patch(Rectangle((X3(-1050), Y3(200)), 70*sc3, 900*sc3, fc=BLU, ec=INK, lw=0.9))
    ax.add_patch(Rectangle((X3(1050-70), Y3(200)), 70*sc3, 900*sc3, fc=BLU, ec=INK, lw=0.9))
    for lay, n in ((0, 4), (1, 3)):
        yb = 200 + lay*(250+60)
        tot = n*250 + (n-1)*30
        start = -tot/2
        for i in range(n):
            ax.add_patch(Rectangle((X3(start + i*280), Y3(yb)), 250*sc3, 250*sc3, fc=LOADQ, ec=INK, lw=0.9))
        if lay == 1:
            ax.add_patch(Rectangle((X3(-560), Y3(200+250)), 1120*sc3, 60*sc3, fc=WOOD, ec=INK, lw=0.7))
    # Zurrgurt (Niederzurren): über den Stapel gespannt
    top = 200 + 250 + 60 + 250
    strap = [(-980, 200), (-565, top), (565, top), (980, 200)]
    ax.plot([X3(p[0]) for p in strap], [Y3(p[1]) for p in strap], color=RED, lw=1.3)
    ax.text(X3(0), Y3(top+380), 'Niederzurren: 3× Ratschengurt LC 2500 daN,\nAntirutschmatten μ=0.6 auf jeder Lage, Kantenschutz',
            fontsize=6.0, color=RED, ha='center')
    dim_v(ax, Y3(200), Y3(200+900), X3(1050)+16, 'Runge 900', dx=3.0)

    # Tabelle Stückzahlen/Gewichte
    tx, ty = 60, 262
    ax.text(tx, ty, 'Riegel («Quertraversen») je Typ – Stückgewichte & max. Ladung', fontsize=7.5, fontweight='bold', color=INK)
    rows = [
        ('Typ', 'Profil Riegel', 'Länge über alles*', '≈ kg/Stk', 'max. Stk (3.0 t NL)', '≈ Ladung'),
        ('A', 'RRK180×100×5', '7514', '160', '12 (Bündel 2×6)', '1.92 t'),
        ('B', 'RRK180×100×6', '7534', '190', '12', '2.28 t'),
        ('C', 'RRK200×150×6', '7554', '245', '9', '2.21 t'),
        ('D', 'RRK250×150×6', '7574', '280', '8', '2.24 t'),
        ('E', 'RRK250×250×6', '7614', '355', '7 (Bündel 4+3)', '2.49 t'),
    ]
    for i, r in enumerate(rows):
        yy = ty - 6 - i*5.6
        fw = 'bold' if i == 0 else 'normal'
        for xx, v in zip((tx, tx+16, tx+52, tx+92, tx+112, tx+152), r):
            ax.text(xx, yy, v, fontsize=6.0, color=INK, fontweight=fw)
    ax.text(tx, ty - 6 - 6*5.6, '* Mass «über alles» aus Ansicht Plan (inkl. Anbauteile); reine Riegellänge kleiner – für Gestell/Bündel ist 7620 Bemessungswert.',
            fontsize=5.6, color=DIM)
    note(ax, 250, 262, [
        '• Beladung symmetrisch, Lastschwerpunkt über Achsaggregat (Jochmitte 2250).',
        '• Lagen durch Hartholz 100×60 trennen; Stirnseiten mit Endsicherung',
        '   (Gurt über Kopf) gegen Längsverschub sichern.',
        '• Gesamtlänge Zug & Überhang: hinten ≤ 5.00 m ab Achsmitte,',
        '   Markierung ab 1.00 m Überhang (VRV Art. 73 / Art. 58 VTS).',
        '• Fahrgeschwindigkeit Bergstrecke gem. interner Weisung KVR/Axpo.',
    ], fs=6.0, title='Beladung & Sicherung')
    pdf.savefig(fig); plt.close(fig)

    # ---------------- BLATT 3: Variante K – Knieträger ----------------
    fig, ax = sheet(pdf, 3, 'Variante K – Knieträger am A-Bock',
                    'Stütze+Auflagerträger hochkant, wie Binder-Transport')
    # Seitenansicht mit A-Bock + Knieträger stehend
    sc = 0.024
    X, Y = draw_grundgestell_seite(ax, 80, 62, sc, abock=True)
    ax.text(40, 186, 'Seitenansicht 1:42', fontsize=7.5, fontweight='bold', color=INK)
    polys, (bw, bh) = knie_poly(1.0)
    offx = 2250 - bw/2  # bbox zentriert über Achsaggregat
    for poly in polys:
        pts = [(X(px + offx), Y(py + 260)) for px, py in poly]
        ax.add_patch(Polygon(pts, closed=True, fc=LOADK, ec=INK, lw=1.0, alpha=0.92))
    dim_h(ax, X(offx), X(offx + bw), Y(-120) - 16, f'Hüllmass Knieträger ca. {int(round(bw, -1))}* (Typ A) – nachmessen!', col=RED)
    dim_v(ax, Y(260), Y(260 + bh), X(offx + bw) + 10, f'Hüllhöhe ca. {int(round(bh, -1))}*', dx=3.2, col=RED)
    dim_v(ax, Y(-1160), Y(260 + bh), X(-1400), 'Gesamthöhe ab Boden prüfen: ≤ 4000!', dx=-3.4, col=RED)
    ax.annotate('Auflagerträger (HEA120…HEA220)\nliegt auf Hartholz der Joche', xy=(X(offx + bw - 1200), Y(330)),
                xytext=(X(offx + bw - 700), Y(1000)), fontsize=6.0, color=INK,
                arrowprops=dict(arrowstyle='->', color=DIM, lw=0.7))
    ax.annotate('Stütze talseitig\n(RRK160…RRW300)', xy=(X(offx + 700), Y(2100)),
                xytext=(X(offx - 1500), Y(2400)), fontsize=6.0, color=INK,
                arrowprops=dict(arrowstyle='->', color=DIM, lw=0.7))
    ax.text(X(2250), Y(3520), 'Überhang vorne/hinten je < 300 – innerhalb Brücke/Deichselbereich',
            fontsize=5.8, color=DIM, ha='center')

    # Querschnitt: A-Bock, Knieträger hochkant beidseitig
    ox3, oy3 = 322, 62; sc3 = 0.0255
    def X3(v): return ox3 + v*sc3
    def Y3(v): return oy3 + v*sc3
    ax.text(292, 186, 'Querschnitt 1:39', fontsize=7.5, fontweight='bold', color=INK)
    ax.add_patch(Rectangle((X3(-1050), Y3(-120)), 2100*sc3, 120*sc3, fc='#e8ecf1', ec=INK, lw=1.0))
    ax.add_patch(Rectangle((X3(-1050), Y3(0)), 2100*sc3, 140*sc3, fc=STEEL, ec=INK, lw=0.9))
    ax.add_patch(Rectangle((X3(-1050), Y3(140)), 2100*sc3, 60*sc3, fc=WOOD, ec=INK, lw=0.7))
    # Knieträger hochkant angelehnt (als schmale Rechtecke geneigt), A-Bock darüber
    for sgn in (-1, 1):
        for i in range(3):
            base = sgn*(260 + i*190)
            top = sgn*(80 + i*190)
            poly = [(X3(base-80), Y3(200)), (X3(base+80), Y3(200)),
                    (X3(top+80), Y3(3050*0.92)), (X3(top-80), Y3(3050*0.92))]
            ax.add_patch(Polygon(poly, closed=True, fc=LOADK, ec=INK, lw=0.8, alpha=0.55))
    # A-Bock
    ax.plot([X3(-900), X3(0)], [Y3(200), Y3(2500)], color=BLU, lw=2.0)
    ax.plot([X3(900), X3(0)], [Y3(200), Y3(2500)], color=BLU, lw=2.0)
    ax.plot([X3(-450), X3(450)], [Y3(1350), Y3(1350)], color=BLU, lw=1.4)
    dim_v(ax, Y3(200), Y3(2500), X3(-1150), 'A-Bock 2300', dx=-3.2)
    ax.annotate('je Seite max. 3 Stk, unten gegen\nJochanschlag, oben an Firstholm\ngekettet (Kette + Spanner 2×)',
                xy=(X3(500), Y3(2200)), xytext=(X3(1150), Y3(1500)), fontsize=6.0, color=RED,
                arrowprops=dict(arrowstyle='->', color=RED, lw=0.8))
    ax.annotate('Niederzurrung unten:\nGurt LC 2500 daN je Joch', xy=(X3(-500), Y3(300)),
                xytext=(X3(-2450), Y3(800)), fontsize=6.0, color=RED,
                arrowprops=dict(arrowstyle='->', color=RED, lw=0.8))

    # Tabelle
    tx, ty = 60, 262
    ax.text(tx, ty, 'Knieträger je Typ (2026) – vormontierte Einheit Stütze talseitig + Auflagerträger', fontsize=7.5, fontweight='bold', color=INK)
    rows = [
        ('Typ', 'Stütze tal (Länge)', 'Auflagerträger', '≈ kg/Stk*', 'max. Stk', '≈ Ladung'),
        ('A', 'RRK160×160×6 (3655)', 'HEA120, L≈3900*', '215', '6 (3 je Seite)', '1.29 t'),
        ('B', 'RRK180×180×6 (3645)', 'HEA140, L≈3900*', '250', '6', '1.50 t'),
        ('C', 'RRK220×220×6 (3610)', 'HEA160, L≈3900*', '305', '6', '1.83 t'),
        ('D', 'RRK250×250×8 (3639)', 'HEA180, L≈3900*', '405', '6', '2.43 t'),
        ('E', 'RRW300×300×8.8 (3655)', 'HEA220, L≈3900*', '540', '4 (2 je Seite)', '2.16 t'),
    ]
    for i, r in enumerate(rows):
        yy = ty - 6 - i*5.6
        fw = 'bold' if i == 0 else 'normal'
        for xx, v in zip((tx, tx+16, tx+62, tx+102, tx+122, tx+156), r):
            ax.text(xx, yy, v, fontsize=6.0, color=INK, fontweight=fw)
    ax.text(tx, ty - 6 - 6*5.6, '* Gewicht = Stütze + Auflagerträger + Kopf-/Stirnplatten, Schätzung ±15 % · Längen ohne Stützenverlängerung/Schuh.',
            fontsize=5.6, color=DIM)
    note(ax, 250, 262, [
        '• Knieträger flach verladen ist NICHT möglich: Hüllbreite ca. 3.3 m',
        '   überschreitet die zulässige Fahrzeugbreite 2.55 m → darum hochkant.',
        '• Beidseitig symmetrisch beladen (links/rechts gleiche Stückzahl).',
        '• Anschlagen nur an den Vormontage-Anschlagpunkten (Montagekonzept',
        '   NalpSolar_51_BE_0300, Kap. 3).',
        '• Höhenkontrolle vor jeder Fahrt: Oberkante Ladung ≤ 4.00 m ab Boden.',
        '• Typ E: Einzelgewicht 540 kg – Verladung nur mit Kran/Stapler.',
    ], fs=6.0, title='Wichtig')
    pdf.savefig(fig); plt.close(fig)

    # ---------------- BLATT 4: Bauteilmasse aus den Stahlbauplänen ----------------
    fig, ax = sheet(pdf, 4, 'Bauteilmasse (Typ 2026) & Prüfliste',
                    'Auszug Mauchle-Pläne – Grundlage der Bemessung')
    tx, ty = 20, 268
    ax.text(tx, ty, 'Primärkonstruktion je Typ – transportrelevante Bauteile', fontsize=8, fontweight='bold', color=INK)
    rows = [
        ('Typ', 'Plan-Nr.', 'Riegel (Quertraverse)', 'Breite über alles', 'Stütze talseitig', 'Stütze bergseitig (Stoss)', 'Auflagerträger', 'Streben'),
        ('A', '24027-S-0-M-008 B', 'RRK180×100×5', '7514', 'RRK160×6 · 3655', 'RRK160×6 · 3107', 'HEA120', 'RRK100×8'),
        ('B', '24027-S-0-M-009 B', 'RRK180×100×6', '7534', 'RRK180×6 · 3645', 'RRK180×6 · 2535', 'HEA140', 'RRK110×6'),
        ('C', '24027-S-0-M-010 B', 'RRK200×150×6', '7554', 'RRK220×6 · 3610', 'RRK220×6 · 2220', 'HEA160', 'RRK140×6'),
        ('D', '24027-S-0-M-006 B', 'RRK250×150×6', '7574', 'RRK250×8 · 3639', 'RRK250×8 · 2127', 'HEA180', 'RRK160×8'),
        ('E', '24027-S-0-M-007 B', 'RRK250×250×6', '7614', 'RRW300×8.8 · 3655', 'RRW300×8.8 · 1923', 'HEA220', 'RRK200×8'),
    ]
    widths = (tx, tx+14, tx+50, tx+96, tx+130, tx+178, tx+232, tx+262)
    for i, r in enumerate(rows):
        yy = ty - 7 - i*6.2
        fw = 'bold' if i == 0 else 'normal'
        for xx, v in zip(widths, r):
            ax.text(xx, yy, v, fontsize=6.2, color=INK, fontweight=fw)
    yy = ty - 7 - 6*6.2 - 3
    for l in ('Achsmass Mikropfähle (Riegelspannweite): 7394 mm bei allen Typen · Alle Masse in mm, Stützenlängen «ohne Verlängerung».',
              'Begriffe: «Quertraverse» (Baustellenbegriff) = Riegel gem. Plan · «Knieträger» = im Tal vormontierte Einheit Stütze talseitig + Auflagerträger.'):
        ax.text(tx, yy, l, fontsize=6.0, color=DIM); yy -= 4.6

    # Skizze Knieträger mit Massen
    ax.text(tx, 198, 'Knieträger – Hüllmass (Typ A, auf Auflagerträger liegend, schematisch)', fontsize=8, fontweight='bold', color=INK)
    sck = 0.017
    polys, (bw, bh) = knie_poly(sck)   # bw/bh in mm (unskaliert)
    for poly in polys:
        pts = [(40 + px, 108 + py) for px, py in poly]
        ax.add_patch(Polygon(pts, closed=True, fc=LOADK, ec=INK, lw=1.0, alpha=0.92))
    bwd, bhd = bw*sck, bh*sck
    dim_h(ax, 40, 40 + bwd, 100, f'ca. {int(round(bw, -1))}*')
    dim_v(ax, 108, 108 + bhd, 40 + bwd + 10, f'ca. {int(round(bh, -1))}*', dx=3.0)
    ax.text(40, 112 + bhd + 12, 'Innenwinkel Stütze/Auflagerträger ca. 120°* (Modulneigung 30°) · Auflagerträger L≈3900*, Knoten ≈900* ab unterem Ende',
            fontsize=6.0, color=DIM)
    ax.text(40, 112 + bhd + 6, '* am vormontierten Stück nachmessen – massgebend für A-Bock-Höhe & Auflagepunkte', fontsize=6.0, color=RED)

    # Prüfliste
    px_, py_ = 250, 198
    note(ax, px_, py_, [
        '☐ Hüllmasse Knieträger (L × H, Winkel) an 1 Stück je Typ nachgemessen',
        '☐ Riegellänge über Stirnplatten nachgemessen (Annahme ≤ 7620)',
        '☐ Basisanhänger: Fahrzeugausweis, Nutzlast, Brückenmass, Rungentaschen',
        '☐ Statischer Nachweis Ladegestell + A-Bock (Fachperson, EN 1090/SIA 263)',
        '☐ Ladungssicherungsnachweis EN 12195-1 (Niederzurren + Formschluss)',
        '☐ Höhen-/Breiten-/Längenkontrolle beladen (≤ 4.00 / ≤ 2.55 m / Überhang)',
        '☐ Zufahrtsbewilligung Bergstrasse (KVR) & Versicherung Werkverkehr',
        '☐ Abnahme durch Bauleitung vor erster Fahrt',
    ], fs=6.4, title='Prüfliste vor Eingabe / Inbetriebnahme')
    pdf.savefig(fig); plt.close(fig)

print('PDF geschrieben.')
