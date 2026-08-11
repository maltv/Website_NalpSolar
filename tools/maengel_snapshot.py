# -*- coding: utf-8 -*-
"""Pendente Maengel aus dem Nalpi-Maengelmanagement holen -> uploads/maengel.json

Quelle ist NICHT SharePoint, sondern das Buildtrack-Backend (Postgres) unter
https://api.buildtrack.ch — derselbe Delta-Feed, den die Nalpi-Extension nutzt
(src/lib/api/maengel/http-maengel-repository.ts) und das Sync-Skript
NalpsChromeExtension/scripts/mangel-issues-sync.py. Der Endpunkt ist ohne
Token lesbar und erlaubt CORS, die Website holt die Daten darum live; diese
Datei ist der Offline-Fallback fuer die Baustelle (kein Empfang am Berg).

Aufruf (aus Website_NalpSolar):
    python tools/maengel_snapshot.py

Danach sw.js-Cache-Version hochzaehlen + commit/push.
"""
import json
import urllib.request
from pathlib import Path

API = "https://api.buildtrack.ch"
PAGE_LIMIT = 2000
MAX_PAGES = 200
OUT = Path(__file__).resolve().parent.parent / "uploads" / "maengel.json"

# Nur was am Berg zaehlt: Maengel an Tischen und Bohrpunkten.
# 'app' (App-Bugs, laufen ueber GitHub-Issues) und 'logistik' bleiben draussen.
ARTEN = ("table", "drillpoint")
PENDENT = ("OFFEN", "IN_BEARBEITUNG")


def api_get(path):
    req = urllib.request.Request(API + path, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def hole_alle():
    since, pages, maengel = 0, 0, []
    while pages < MAX_PAGES:
        page = api_get(f"/api/v1/maengel/changes?since={since}&limit={PAGE_LIMIT}")
        rows = page.get("maengel") or []
        maengel.extend(rows)
        pages += 1
        wm = page.get("watermark")
        if not rows or wm is None or wm == since:
            break
        since = wm
    return maengel


def main():
    roh = hole_alle()
    pendent = [
        m for m in roh
        if not m.get("deletedAt") and not m.get("duplicateOf")
        and m.get("status") in PENDENT and m.get("entityType") in ARTEN
    ]
    schlank = [{
        "nr": m.get("displayNo"),
        "art": m.get("entityType"),
        "key": m.get("entityKey"),
        "tisch": (m.get("entityKey") or "").split("_")[0],
        "titel": m.get("title"),
        "schwere": m.get("severity"),
        "status": m.get("status"),
        "kind": m.get("kind"),
        "erfasst": (m.get("createdAt") or "")[:10],
        "von": m.get("createdBy"),
        "frist": (m.get("behebenBis") or "")[:10] or None,
    } for m in pendent]
    schlank.sort(key=lambda x: (x["tisch"].zfill(6), x["key"] or ""))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "quelle": "api.buildtrack.ch /api/v1/maengel/changes (Nalpi-Maengelmanagement)",
        "anzahl": len(schlank),
        "maengel": schlank,
    }, ensure_ascii=False), encoding="utf-8")

    kritisch = len([m for m in schlank if m["schwere"] == "KRITISCH"])
    tische = len({m["tisch"] for m in schlank})
    print(f"{len(roh)} Maengel gelesen -> {len(schlank)} pendent an {tische} Tischen "
          f"({kritisch} kritisch) -> {OUT}")


if __name__ == "__main__":
    main()
