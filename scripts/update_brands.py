#!/usr/bin/env python3
"""Regenerate brands/<département>.json (station id -> [brand shortName, station name]) for DEPARTMENTS, and
brands/names.json (brand shortName -> display name), from 2aaz.

The official feed has no brand nor station name. Rather than asking 2aaz per station on every page load,
the areas used most are shipped pre-built; elsewhere the page asks 2aaz itself and keeps the answer in the
browser. To pre-build another area, add its départements to DEPARTMENTS and widen AREA to cover them.

2aaz lists at most 20 stations per request, and paging through a large box repeats and skips stations: the
area is walked in CELL-degree cells, then every official station of DEPARTMENTS still missing is asked for
individually.
"""
import io
import json
import math
import pathlib
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = "https://api.prix-carburants.2aaz.fr"
UA = {"User-Agent": "essence-tracker/0.1 (personal)", "Accept": "application/json"}
PAGE = 20
DEPARTMENTS = {"75", "77", "78", "91", "92", "93", "94", "95", "60"}   # Île-de-France + Oise
AREA = (48.1, 1.4, 49.8, 3.6)                                           # south, west, north, east covering them
CELL = 0.5


def zone(station_id):
    s = str(station_id)
    return s[:3] if s.startswith("97") else s[:2]


def cells(s, w, n, e):
    for i in range(math.ceil((n - s) / CELL)):
        for j in range(math.ceil((e - w) / CELL)):
            a, b = s + i * CELL, w + j * CELL
            yield f"{a:.2f},{b:.2f};{min(a + CELL, n):.2f},{min(b + CELL, e):.2f}"


def get(path, headers=None):
    req = urllib.request.Request(f"{API}/{path}", headers={**UA, **(headers or {})})
    for attempt in range(3):
        try:
            return json.load(urllib.request.urlopen(req, timeout=30))
        except urllib.error.HTTPError as err:
            if err.code in (404, 416):  # unknown station / past the last page
                return []
            time.sleep(2 * (attempt + 1))
        except OSError:
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f"2aaz keeps failing on {path}")


def pages(path, unit):
    start = 1
    while batch := get(path, {"Range": f"{unit}={start}-{start + PAGE - 1}"}):
        yield from batch
        start += PAGE
        time.sleep(0.1)  # stay polite with a community API


zones = {}


def keep(st):
    if st and zone(st["id"]) in DEPARTMENTS:
        zones.setdefault(zone(st["id"]), {})[str(st["id"])] = [(st.get("Brand") or {}).get("shortName"), st.get("name")]


for bbox in cells(*AREA):
    for st in pages(f"stations/within/bbox/{bbox}", "station"):
        keep(st)

raw = urllib.request.urlopen(urllib.request.Request("https://donnees.roulez-eco.fr/opendata/instantane", headers=UA)).read()
official = {p.get("id") for p in ET.fromstring(zipfile.ZipFile(io.BytesIO(raw)).read("PrixCarburants_instantane.xml")).iter("pdv")}
found = {sid for z in zones.values() for sid in z}
missing = sorted(sid for sid in official if zone(sid) in DEPARTMENTS and sid not in found)
print(f"{len(missing)} official stations missed by the cells, asked one by one")
for sid in missing:
    keep(get(f"station/{sid}"))  # unknown to 2aaz: the page shows the unbranded logo
    time.sleep(0.1)

out = ROOT / "brands"
out.mkdir(exist_ok=True)
for z, stations in zones.items():
    (out / f"{z}.json").write_text(json.dumps(dict(sorted(stations.items())), ensure_ascii=False, separators=(",", ":")) + "\n")
names = {b["shortName"]: b["name"] for b in pages("brands/", "brand")}
(out / "names.json").write_text(json.dumps(dict(sorted(names.items())), ensure_ascii=False, separators=(",", ":")) + "\n")
covered = sum(len(zones.get(d, {})) for d in DEPARTMENTS)
print(f"{covered} stations in {len(zones)} files, {len(names)} brand names; "
      f"{sum(1 for sid in official if zone(sid) in DEPARTMENTS)} official stations in these départements")
