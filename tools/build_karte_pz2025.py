# -*- coding: utf-8 -*-
"""Karte PZ2025 – die noch zu stellenden Restkonstruktionen.
   Luftbild swisstopo WMS + Tischpolygone aus modultische_all.json (LV95).
   Farben: orange = im Tal vormontiert (Passstuecke pruefen), rot = noch vormontieren,
   grau = PZ2025-Tisch steht schon. Legende steht im HTML-Blatt, nicht im Bild."""
import io, json, math, os, urllib.request
from PIL import Image, ImageDraw, ImageFont

WEB = r"c:\Users\MaltVic\OneDrive - Strabag BRVZ GmbH\Claude_Projects\Nalps_Ultra_KI\Website_NalpSolar"
ZIEL = r"c:\Users\MaltVic\OneDrive - Strabag BRVZ GmbH\Claude_Projects\Nalps_Ultra_KI\Vormontage_QR\260814_Karte_PZ2025.png"

VORMONTIERT = ["359", "361", "362", "383"]          # liegen vormontiert im Tal
NEU         = ["326", "342", "381"]                 # noch nicht vormontiert
STEHT       = ["327", "357", "358", "379", "380", "382", "422", "1620", "1623", "2157"]
ZIEHEN = VORMONTIERT + NEU

tische = {t[0]: t for t in json.load(io.open(os.path.join(WEB, "uploads", "tables", "modultische_all.json"), encoding="utf-8"))}
kern = [tische[i] for i in ZIEHEN if i in tische]     # Ausschnitt spannt nur ueber die 7
print("Kern-Tische mit Geometrie:", len(kern), "von", len(ZIEHEN))

RAND = 26.0
minE = min(t[1] for t in kern) - RAND; maxE = max(t[1] for t in kern) + RAND
minN = min(t[2] for t in kern) - RAND; maxN = max(t[2] for t in kern) + RAND
breite_m = maxE - minE; hoehe_m = maxN - minN
BREITE = 1080
HOEHE = int(BREITE * hoehe_m / breite_m)
print("Ausschnitt %.0f x %.0f m -> %d x %d px" % (breite_m, hoehe_m, BREITE, HOEHE))

url = ("https://wms.geo.admin.ch/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
       "&LAYERS=ch.swisstopo.swissimage&STYLES=&CRS=EPSG:2056"
       "&BBOX=%f,%f,%f,%f&WIDTH=%d&HEIGHT=%d&FORMAT=image/jpeg" % (minE, minN, maxE, maxN, BREITE, HOEHE))
try:
    karte = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=60).read())).convert("RGB")
    print("Luftbild geladen:", karte.size)
except Exception as e:
    print("WMS nicht erreichbar (%s) - neutraler Hintergrund" % e)
    karte = Image.new("RGB", (BREITE, HOEHE), (58, 74, 60))

d = ImageDraw.Draw(karte, "RGBA")

def px(E, N):
    return ((E - minE) / breite_m * BREITE, (maxN - N) / hoehe_m * HOEHE)

def f(sz, fett=True):
    p = r"C:\Windows\Fonts\arialbd.ttf" if fett else r"C:\Windows\Fonts\arial.ttf"
    try: return ImageFont.truetype(p, sz)
    except Exception: return ImageFont.load_default()

BREITE_TISCH = 3.4

def tisch(tid, fuell, rand, dick=3):
    t = tische.get(tid)
    if not t: return None
    E, N, az, laenge = t[1], t[2], t[4], t[5]
    aL = math.radians(az + 90.0); aQ = math.radians(az)
    dLe, dLn = math.sin(aL) * laenge / 2, math.cos(aL) * laenge / 2
    dQe, dQn = math.sin(aQ) * BREITE_TISCH / 2, math.cos(aQ) * BREITE_TISCH / 2
    ecken = [px(E + dLe + dQe, N + dLn + dQn), px(E + dLe - dQe, N + dLn - dQn),
             px(E - dLe - dQe, N - dLn - dQn), px(E - dLe + dQe, N - dLn + dQn)]
    d.polygon(ecken, fill=fuell, outline=rand, width=dick)
    return px(E, N), az

belegt = []   # gesetzte Label-Rechtecke (x0,y0,x1,y1) fuer die Kollisionspruefung

def frei(r):
    for b in belegt:
        if not (r[2] < b[0] or r[0] > b[2] or r[3] < b[1] or r[1] > b[3]): return False
    return True

def label(cx, cy, az, chip, laenge_px):
    """setzt chip moeglichst nah am Tischzentrum, weicht sonst entlang der Laengsachse aus"""
    aL = math.radians(az + 90.0)
    dx, dy = math.sin(aL), -math.cos(aL)          # Bildrichtung der Laengsachse
    for schritt in [0, 0.30, -0.30, 0.46, -0.46, 0.62, -0.62]:
        px_ = cx + dx * laenge_px * schritt
        py_ = cy + dy * laenge_px * schritt
        r = (px_ - chip.width / 2, py_ - chip.height / 2, px_ + chip.width / 2, py_ + chip.height / 2)
        if frei(r):
            belegt.append(r)
            karte.paste(chip, (int(r[0]), int(r[1])), chip)
            return
    belegt.append((cx - chip.width / 2, cy - chip.height / 2, cx + chip.width / 2, cy + chip.height / 2))
    karte.paste(chip, (int(cx - chip.width / 2), int(cy - chip.height / 2)), chip)

def laenge_in_px(tid):
    return tische[tid][5] / breite_m * BREITE

# 1) alle uebrigen Tische im Ausschnitt nur duenn andeuten
for tid, t in tische.items():
    if tid in ZIEHEN or tid in STEHT: continue
    if minE <= t[1] <= maxE and minN <= t[2] <= maxN:
        tisch(tid, (255, 255, 255, 45), (255, 255, 255, 130), 1)

# 2) Flaechen: erst die schon stehenden PZ2025-Tische, dann die 7
mitte = {}
for tid in STEHT:
    r = tisch(tid, (120, 120, 120, 150), (240, 240, 240), 2)
    if r: mitte[tid] = r
for tid in ZIEHEN:
    if tid in VORMONTIERT: fuell, rand = (245, 150, 20, 170), (255, 235, 190)
    else:                  fuell, rand = (215, 38, 34, 170), (255, 255, 255)
    r = tisch(tid, fuell, rand, 4)
    if r: mitte[tid] = r

def dreh(chip, az):
    w = -az % 360
    if w > 90: w -= 180
    if w < -90: w += 180
    return chip.rotate(w, expand=True, resample=Image.BICUBIC)

# 3) Beschriftung – die 7 zuerst, damit sie den besten Platz bekommen
for tid in ZIEHEN:
    if tid not in mitte: continue
    (cx, cy), az = mitte[tid]
    txt = (120, 60, 0) if tid in VORMONTIERT else (150, 0, 0)
    fnt = f(42)
    tb = d.textbbox((0, 0), tid, font=fnt)
    chip = Image.new("RGBA", (tb[2] - tb[0] + 26, tb[3] - tb[1] + 24), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chip)
    cd.rounded_rectangle([0, 0, chip.width - 1, chip.height - 1], radius=7,
                         fill=(255, 255, 255, 248), outline=txt, width=3)
    cd.text((chip.width / 2, chip.height / 2), tid, font=fnt, fill=txt, anchor="mm")
    label(cx, cy, az, dreh(chip, az), laenge_in_px(tid))

for tid in STEHT:
    if tid not in mitte: continue
    (cx, cy), az = mitte[tid]
    chip = Image.new("RGBA", (60, 30), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chip)
    cd.rounded_rectangle([0, 0, 59, 29], radius=5, fill=(255, 255, 255, 215))
    cd.text((30, 15), tid, font=f(21, False), fill=(70, 70, 70), anchor="mm")
    label(cx, cy, az, dreh(chip, az), laenge_in_px(tid))

# Nordpfeil
nx, ny = BREITE - 58, 58
d.ellipse([nx - 34, ny - 34, nx + 34, ny + 34], fill=(255, 255, 255, 225))
d.polygon([(nx, ny - 26), (nx - 11, ny + 12), (nx, ny + 4), (nx + 11, ny + 12)], fill=(20, 20, 20))
d.text((nx, ny + 20), "N", font=f(17), fill=(20, 20, 20), anchor="mm")

# Massstab 20 m
m20 = 20.0 / breite_m * BREITE
x0, y0 = 26, HOEHE - 34
d.rectangle([x0 - 8, y0 - 26, x0 + m20 + 8, y0 + 14], fill=(255, 255, 255, 225))
d.rectangle([x0, y0, x0 + m20, y0 + 7], fill=(20, 20, 20))
d.text((x0 + m20 / 2, y0 - 12), "20 m", font=f(23), fill=(20, 20, 20), anchor="mm")

os.makedirs(os.path.dirname(ZIEL), exist_ok=True)
karte.save(ZIEL, quality=90)
print("gespeichert:", ZIEL, karte.size, "%.0f KB" % (os.path.getsize(ZIEL) / 1024))
