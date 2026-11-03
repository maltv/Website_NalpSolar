# -*- coding: utf-8 -*-
"""Pendente Maengel aus dem Nalpi-Maengelmanagement holen -> uploads/maengel.json

Quelle ist NICHT SharePoint, sondern das Buildtrack-Backend (Postgres) unter
https://api.buildtrack.ch: die Query-Engine-Sicht `maengel`
(GET /api/w1/q/maengel, PostgREST-Syntax). Der alte Delta-Feed
/api/v1/maengel/changes ist abgeschaltet. Die Website liest dieselbe Sicht
live (assets/js/nalp-buildtrack.js); diese Datei ist der Offline-Fallback
fuer die Baustelle (kein Empfang am Berg) und der Stand ohne Token.

TOKEN (Pflicht, die Sicht ist nie ohne Token lesbar): Umgebungsvariable
NALPS_API_TOKEN, oder NALPS_API_TOKEN_FILE = Pfad einer Datei, die nur den
Token enthaelt — wie bei tools/nalpi_stand_api.py. Das Konto braucht den
Lesebereich maengel:read. Der Token wird nie ausgegeben.

Aufruf (aus Website_NalpSolar):
    python tools/maengel_snapshot.py

Danach sw.js-Cache-Version hochzaehlen + commit/push.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

API = "https://api.buildtrack.ch"
PAGE_LIMIT = 5000      # Zeilen je Abruf; die Engine deckelt bei 10000
MAX_PAGES = 20
OUT = Path(__file__).resolve().parent.parent / "uploads" / "maengel.json"

# Nur was am Berg zaehlt: pendente Maengel an Tischen und Bohrpunkten.
# 'app' (App-Bugs, laufen ueber GitHub-Issues), 'logistik' und 'passstueck' bleiben draussen.
# Geloeschte und zusammengefuehrte Maengel sind in der Sicht nie drin.
SPALTEN = "display_no,kind,entity_type,entity_key,title,severity,status,created_on,beheben_bis"
ABFRAGE = (f"select={SPALTEN}&status=in.(OFFEN,IN_BEARBEITUNG)"
           "&entity_type=in.(table,drillpoint)&order=display_no")


def token():
    """Token aus NALPS_API_TOKEN oder aus der Datei NALPS_API_TOKEN_FILE. Nie ausgeben."""
    t = (os.environ.get("NALPS_API_TOKEN") or "").strip()
    if t:
        return t
    pfad = (os.environ.get("NALPS_API_TOKEN_FILE") or "").strip()
    if pfad:
        try:
            t = Path(pfad).read_text(encoding="utf-8").strip()
        except OSError as e:
            sys.exit(f"FEHLER: Token-Datei nicht lesbar ({e.__class__.__name__}).")
        if t:
            return t
    sys.exit("FEHLER: kein Token. NALPS_API_TOKEN setzen oder NALPS_API_TOKEN_FILE auf eine Datei zeigen lassen.")


def api_get(path, tok):
    req = urllib.request.Request(API + path, headers={
        "accept": "application/json",
        "authorization": "Bearer " + tok,
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # 416 = offset hinter der letzten Zeile: nichts mehr. Alles andere ist ein Fehler, ohne Token im Text.
        if e.code == 416:
            return []
        sys.exit(f"FEHLER: {API}{path.split('?')[0]} antwortet {e.code}"
                 + (" (Token fehlt oder hat maengel:read nicht)" if e.code in (401, 403) else ""))


def hole_alle(tok):
    offset, pages, rows = 0, 0, []
    while pages < MAX_PAGES:
        page = api_get(f"/api/w1/q/maengel?{ABFRAGE}&limit={PAGE_LIMIT}&offset={offset}", tok)
        if not isinstance(page, list):
            sys.exit("FEHLER: unerwartete Antwort (keine Liste).")
        rows.extend(page)
        pages += 1
        if len(page) < PAGE_LIMIT:
            break
        offset += len(page)
    return rows


def main():
    tok = token()
    pendent = hole_alle(tok)
    del tok
    schlank = [{
        "nr": m.get("display_no"),
        "art": m.get("entity_type"),
        "key": m.get("entity_key"),
        "tisch": (m.get("entity_key") or "").split("_")[0],
        "titel": m.get("title"),
        "schwere": m.get("severity"),
        "status": m.get("status"),
        "kind": m.get("kind"),
        "erfasst": m.get("created_on") or "",
        # Wer erfasst hat, gibt die Sicht nicht her (Personendaten bleiben im Maengeltool).
        "von": None,
        "frist": m.get("beheben_bis") or None,
    } for m in pendent]
    schlank.sort(key=lambda x: (x["tisch"].zfill(6), x["key"] or ""))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "quelle": "api.buildtrack.ch /api/w1/q/maengel (Nalpi-Maengelmanagement)",
        "anzahl": len(schlank),
        "maengel": schlank,
    }, ensure_ascii=False), encoding="utf-8")

    kritisch = len([m for m in schlank if m["schwere"] == "KRITISCH"])
    tische = len({m["tisch"] for m in schlank})
    print(f"{len(schlank)} pendente Maengel an {tische} Tischen "
          f"({kritisch} kritisch) -> {OUT}")


if __name__ == "__main__":
    main()
