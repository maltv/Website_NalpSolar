# -*- coding: utf-8 -*-
r"""Baut aus dem Drohnen-Orthofoto der Baustelle (mosaic.pmtiles auf SharePoint)
ein scharfes Luftbild fuer die Auftragskarten der Website.

Warum: das offline hinterlegte SWISSIMAGE hat 0.28 m/px – bei einem 60-m-
Ausschnitt sieht das matschig aus. Das Drohnen-Ortho liegt bis Zoom 21
(~5 cm/px) vor.

Zugriff ohne 91-MB-Download: die PMTiles-Datei wird ueber den angemeldeten
Browser (CDP, Port 9222) mit HTTP-Range-Requests gelesen – es kommen nur die
Kacheln des gewuenschten Ausschnitts.

Aufruf (LV95-Bereich + Zoom):
  python tools/build_ortho_ausschnitt.py 2701740 1165790 2701960 1165920 20 auftrag_42

Ergebnis: uploads/ortho/<name>.jpg + uploads/ortho/<name>.json (Bbox LV95)
"""
import asyncio, base64, importlib.util, io, json, math, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJEKT = os.path.dirname(BASE)
CRUD = os.path.join(PROJEKT, "NalpsChromeExtension", "scripts", "cdp-sp-crud.py")
DATEI = "/sites/RKDMNalpSolar/Shared Documents/Extension/Map/ortho/mosaic/mosaic.pmtiles"
SITE = "/sites/RKDMNalpSolar"
ZIEL = os.path.join(BASE, "uploads", "ortho")

spec = importlib.util.spec_from_file_location("crud", CRUD)
crud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crud)

# SharePoint beantwortet Range-Header nicht - deshalb wird die Datei EINMAL in
# den Speicher des angemeldeten Tabs geladen und dort in Scheiben geschnitten.
_LADEN = """
(async () => {
  if (window.__ortho) return JSON.stringify({ status: 200, len: window.__ortho.length });
  const r = await fetch(%s, { credentials: 'include' });
  if (!r.ok) return JSON.stringify({ status: r.status, len: 0 });
  window.__ortho = new Uint8Array(await r.arrayBuffer());
  return JSON.stringify({ status: 200, len: window.__ortho.length });
})()
"""

_SCHEIBE = """
(() => {
  const u = window.__ortho.subarray(%d, %d);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return JSON.stringify({ status: 206, b64: btoa(s) });
})()
"""


def lv95_wgs84(E, N):
    y = (E - 2600000.0) / 1e6
    x = (N - 1200000.0) / 1e6
    lam = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3
    phi = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x ** 3
    return phi * 100 / 36, lam * 100 / 36


def deg2px(lat, lon, z):
    n = 256 * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    la = math.radians(lat)
    y = (1.0 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2.0 * n
    return x, y


class Leser:
    """Byte-Bereiche der SharePoint-Datei ueber den angemeldeten Tab"""

    def __init__(self, ws, loop):
        self.ws, self.loop = ws, loop
        q = crud._url_quote(DATEI)
        self.url = ("window.location.origin + " +
                    json.dumps(SITE + "/_api/web/getFileByServerRelativeUrl('%s')/$value" % q))
        self.gelesen = 0

    async def _laden(self):
        res = await crud._evaluate(self.ws, _LADEN % self.url)
        if isinstance(res, str):
            res = json.loads(res)
        if res.get("status") != 200 or not res.get("len"):
            raise RuntimeError("Datei nicht ladbar: HTTP %s" % res.get("status"))
        return res["len"]

    async def _hole(self, off, laenge):
        res = await crud._evaluate(self.ws, _SCHEIBE % (off, off + laenge))
        if isinstance(res, str):
            res = json.loads(res)
        if res.get("status") not in (200, 206):
            raise RuntimeError("Range %d+%d -> HTTP %s" % (off, laenge, res.get("status")))
        roh = base64.b64decode(res["b64"])
        self.gelesen += len(roh)
        return roh

    def sync(self, off, laenge):
        return self.loop.run_until_complete(self._hole(off, laenge))


def main():
    if len(sys.argv) < 7:
        print(__doc__); return 1
    minE, minN, maxE, maxN = [float(x) for x in sys.argv[1:5]]
    zoom = int(sys.argv[5])
    name = sys.argv[6]

    import websockets
    from pmtiles import tile as pmt

    os.makedirs(ZIEL, exist_ok=True)
    loop = asyncio.new_event_loop()
    tab = crud._find_sp_tab()
    if not tab:
        print("Kein angemeldeter SharePoint-Tab auf Port 9222"); return 2
    ws = loop.run_until_complete(websockets.connect(tab["webSocketDebuggerUrl"], max_size=None))
    loop.run_until_complete(crud._cdp(ws, "Runtime.enable"))
    leser = Leser(ws, loop)
    print("Lade Orthofoto in den Browser-Speicher (einmalig) ...")
    groesse = loop.run_until_complete(leser._laden())
    print("  %.1f MB im Tab" % (groesse / 1048576))

    kopf = pmt.deserialize_header(leser.sync(0, 127))
    if zoom > kopf["max_zoom"]:
        zoom = kopf["max_zoom"]
    print("PMTiles z%d..%d, Kacheln %s" % (kopf["min_zoom"], kopf["max_zoom"], kopf["tile_type"]))

    # Kachelbereich bestimmen (Web-Mercator)
    ecken = [lv95_wgs84(minE, minN), lv95_wgs84(minE, maxN),
             lv95_wgs84(maxE, minN), lv95_wgs84(maxE, maxN)]
    pxs = [deg2px(la, lo, zoom) for la, lo in ecken]
    x0, x1 = min(p[0] for p in pxs), max(p[0] for p in pxs)
    y0, y1 = min(p[1] for p in pxs), max(p[1] for p in pxs)
    tx0, tx1 = int(x0 // 256), int(x1 // 256)
    ty0, ty1 = int(y0 // 256), int(y1 // 256)
    n_k = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    print("Zoom %d: %d x %d Kacheln (%d)" % (zoom, tx1 - tx0 + 1, ty1 - ty0 + 1, n_k))

    # Verzeichnisse durchlaufen (Root + ggf. Leaf)
    def dir_lesen(off, laenge):
        # deserialize_directory entpackt selbst (gzip)
        return pmt.deserialize_directory(leser.sync(off, laenge))

    root = dir_lesen(kopf["root_offset"], kopf["root_length"])

    def eintrag_suchen(tid):
        eintraege, off, laenge = root, kopf["leaf_directory_offset"], kopf["leaf_directory_length"]
        for _ in range(4):
            e = pmt.find_tile(eintraege, tid)
            if e is None:
                return None
            if e.run_length == 0:                      # verweist auf ein Leaf-Directory
                eintraege = dir_lesen(off + e.offset, e.length)
                continue
            return e
        return None

    from PIL import Image
    breite, hoehe = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    bild = Image.new("RGB", (breite, hoehe), (60, 66, 72))
    ok = 0
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            tid = pmt.zxy_to_tileid(zoom, tx, ty)
            e = eintrag_suchen(tid)
            if not e:
                continue
            roh = leser.sync(kopf["tile_data_offset"] + e.offset, e.length)
            try:
                k = Image.open(io.BytesIO(roh)).convert("RGB")
            except Exception:
                continue
            bild.paste(k, ((tx - tx0) * 256, (ty - ty0) * 256))
            ok += 1
        print("  Zeile %d/%d – %d Kacheln, %.1f MB gelesen" % (
            ty - ty0 + 1, ty1 - ty0 + 1, ok, leser.gelesen / 1048576))

    # auf den gewuenschten Bereich zuschneiden
    bild = bild.crop((int(x0 - tx0 * 256), int(y0 - ty0 * 256),
                      int(x1 - tx0 * 256), int(y1 - ty0 * 256)))
    p_jpg = os.path.join(ZIEL, name + ".jpg")
    bild.save(p_jpg, quality=88, optimize=True)
    meta = {"minE": minE, "minN": minN, "maxE": maxE, "maxN": maxN,
            "w": bild.width, "h": bild.height, "zoom": zoom,
            "quelle": "Drohnen-Orthofoto NalpSolar (mosaic.pmtiles, SharePoint), Stand 22.04.2026"}
    io.open(os.path.join(ZIEL, name + ".json"), "w", encoding="utf-8", newline="\n").write(
        json.dumps(meta, ensure_ascii=False))
    print("-> %s (%dx%d, %.1f KB), %d Kacheln, %.1f MB gelesen" % (
        p_jpg, bild.width, bild.height, os.path.getsize(p_jpg) / 1024, ok, leser.gelesen / 1048576))
    loop.run_until_complete(ws.close())
    return 0


if __name__ == "__main__":
    sys.exit(main())
