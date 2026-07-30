# -*- coding: utf-8 -*-
"""Auftragskarte Bereich 2.2: Luftbild (swisstopo WMS) + Tischpolygone mit
   Reihenfolge-Nummer und Tisch-ID. Quelle Geometrie: modultische_all.json
   (LV95, tisch_ausrichtung = Modul-Blickrichtung, Laengsachse = az+90 Grad)."""
import io, json, math, os, urllib.request
from PIL import Image, ImageDraw, ImageFont

WEB = r"c:\Users\MaltVic\OneDrive - Strabag BRVZ GmbH\Claude_Projects\Nalps_Ultra_KI\Website_NalpSolar"
ZIEL = os.path.join(WEB, "assets", "img", "auftrag_bereich22.png")
FOLGE = json.load(io.open(r"C:\Users\MaltVic\AppData\Local\Temp\claude\folge22.json"))
SPAETER = {"371", "370", "369"}

tische = {t[0]: t for t in json.load(io.open(os.path.join(WEB, "uploads", "tables", "modultische_all.json"), encoding="utf-8"))}
aus = [tische[i] for i in FOLGE if i in tische]
print("Tische mit Geometrie:", len(aus), "von", len(FOLGE))

RAND = 45.0
minE = min(t[1] for t in aus) - RAND; maxE = max(t[1] for t in aus) + RAND
minN = min(t[2] for t in aus) - RAND; maxN = max(t[2] for t in aus) + RAND
# auf Bildseitenverhaeltnis bringen
BREITE = 1300
hoehe_m = maxN - minN; breite_m = maxE - minE
HOEHE = int(BREITE * hoehe_m / breite_m)
print("Ausschnitt %.0f x %.0f m -> %d x %d px" % (breite_m, hoehe_m, BREITE, HOEHE))

url = ("https://wms.geo.admin.ch/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
       "&LAYERS=ch.swisstopo.swissimage&STYLES=&CRS=EPSG:2056"
       "&BBOX=%f,%f,%f,%f&WIDTH=%d&HEIGHT=%d&FORMAT=image/jpeg" % (minE, minN, maxE, maxN, BREITE, HOEHE))
try:
    roh = urllib.request.urlopen(url, timeout=60).read()
    karte = Image.open(io.BytesIO(roh)).convert("RGB")
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

BREITE_TISCH = 3.0
for nr, tid in enumerate([t[0] for t in aus], 1):
    t = tische[tid]
    E, N, az, laenge = t[1], t[2], t[4], t[5]
    aL = math.radians(az + 90.0)                  # Laengsachse
    aQ = math.radians(az)                         # quer dazu
    dLe, dLn = math.sin(aL) * laenge / 2, math.cos(aL) * laenge / 2
    dQe, dQn = math.sin(aQ) * BREITE_TISCH / 2, math.cos(aQ) * BREITE_TISCH / 2
    ecken = [px(E + dLe + dQe, N + dLn + dQn), px(E + dLe - dQe, N + dLn - dQn),
             px(E - dLe - dQe, N - dLn - dQn), px(E - dLe + dQe, N - dLn + dQn)]
    spaet = tid in SPAETER
    d.polygon(ecken, fill=(255, 190, 60, 130) if spaet else (215, 38, 34, 130),
              outline=(255, 210, 90) if spaet else (255, 255, 255))
    # Nummer + ID, in die Tischachse gedreht (sonst ueberlappen die Reihen)
    cx, cy = px(E, N)
    label = "%d · %s" % (nr, tid)
    fnt = f(19)
    tb = d.textbbox((0, 0), label, font=fnt)
    w, h = tb[2] - tb[0], tb[3] - tb[1]
    chip = Image.new("RGBA", (w + 16, h + 13), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chip)
    cd.rounded_rectangle([0, 0, chip.width - 1, chip.height - 1], radius=6, fill=(255, 255, 255, 238))
    cd.text((chip.width / 2, chip.height / 2), label, font=fnt, fill=(20, 20, 20), anchor="mm")
    winkel = -az % 360                      # Laengsachse im Bild
    if winkel > 90: winkel -= 180
    if winkel < -90: winkel += 180
    chip = chip.rotate(winkel, expand=True, resample=Image.BICUBIC)
    karte.paste(chip, (int(cx - chip.width / 2), int(cy - chip.height / 2)), chip)

# Legende
lh = 108
d.rectangle([0, 0, BREITE, lh], fill=(255, 255, 255, 232))
d.text((16, 10), "Bereich 2.2 · Reihenfolge Vormontage (1 → %d)" % len(aus), font=f(30), fill=(26, 26, 26))
d.rectangle([16, 56, 44, 78], fill=(215, 38, 34, 200), outline=(255, 255, 255))
d.text((54, 58), "zuerst vormontieren (oben → unten, Nord → Süd)", font=f(20, False), fill=(60, 60, 60))
d.rectangle([16, 82, 44, 100], fill=(255, 190, 60, 220), outline=(200, 150, 40))
d.text((54, 82), "371 / 370 / 369 – später (Montage ab Baupiste)", font=f(20, False), fill=(60, 60, 60))
d.text((BREITE - 16, 62), "Norden ↑", font=f(22), fill=(60, 60, 60), anchor="ra")

os.makedirs(os.path.dirname(ZIEL), exist_ok=True)
karte.save(ZIEL, quality=88)
print("gespeichert:", ZIEL, karte.size, "%.0f KB" % (os.path.getsize(ZIEL) / 1024))
