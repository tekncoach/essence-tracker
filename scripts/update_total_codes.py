#!/usr/bin/env python3
"""Regenerate total-codes.json: prix-carburants station id -> TotalEnergies locator code (NFxxxxxx), France-wide.

Used for the "Fiche TotalEnergies" link. Each TotalEnergies fuel station listed by Woosmap is matched to the
nearest official station of the same département if within SAME_DEPT_M metres, else to the nearest one with the
same postcode within SAME_CP_M metres (official coordinates are rounded to ~100 m and sometimes wrong; some
postcodes are CEDEX ones). Postcode first would pair a store with a neighbouring competitor. When two stores claim the same station, the closer one wins. Unmatched stores are counted, not guessed.

Needs TE_WOOSMAP_KEY: the public "woos-..." key the locator.totalenergies.com front end sends to
api.woosmap.com (visible in the network tab). The key only works with that site as referer, which is why
this runs offline instead of in the page.
"""
import io
import json
import math
import os
import pathlib
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

SAME_CP_M, SAME_DEPT_M = 1000, 250
ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {"User-Agent": "essence-tracker/0.1 (personal)"}


def dist_m(a, b):
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 12742000 * math.asin(math.sqrt(h))


key = os.environ.get("TE_WOOSMAP_KEY") or exit("TE_WOOSMAP_KEY missing")

# Official stations, grouped by postcode.
raw = urllib.request.urlopen(urllib.request.Request("https://donnees.roulez-eco.fr/opendata/instantane", headers=UA)).read()
xml = zipfile.ZipFile(io.BytesIO(raw)).read("PrixCarburants_instantane.xml")
by_cp, by_dept = {}, {}
for pdv in ET.fromstring(xml).iter("pdv"):
    if pdv.get("latitude") and pdv.get("longitude"):
        pos = (float(pdv.get("latitude")) / 1e5, float(pdv.get("longitude")) / 1e5)
        by_cp.setdefault(pdv.get("cp"), []).append((pdv.get("id"), pos))
        by_dept.setdefault(pdv.get("cp")[:2], []).append((pdv.get("id"), pos))


def nearest(candidates, point):
    return min(((sid, dist_m(point, pos)) for sid, pos in candidates), key=lambda x: x[1], default=(None, math.inf))


matches, stores, page, pages = {}, 0, 1, 1   # official id -> (distance, NF code)
while page <= pages:
    params = urllib.parse.urlencode({"key": key, "query": 'user.poiType:=FUELING AND user.country:="FR"',
                                     "stores_by_page": 300, "page": page})
    req = urllib.request.Request(f"https://api.woosmap.com/stores/search/?{params}",
                                 headers={**UA, "Referer": "https://locator.totalenergies.com/"})
    data = json.load(urllib.request.urlopen(req))
    pages = data["pagination"]["pageCount"]
    for f in data["features"]:
        stores += 1
        lon, lat = f["geometry"]["coordinates"]
        zipcode = f["properties"]["address"].get("zipcode") or ""
        sid, d = nearest(by_dept.get(zipcode[:2], []), (lat, lon))
        if d > SAME_DEPT_M:
            sid, d = nearest(by_cp.get(zipcode, []), (lat, lon))
            if d > SAME_CP_M:
                continue
        if sid not in matches or d < matches[sid][0]:
            matches[sid] = (d, f["properties"]["user_properties"]["location_id"])
    page += 1

codes = {sid: code for sid, (_, code) in matches.items()}
(ROOT / "total-codes.json").write_text(json.dumps(dict(sorted(codes.items())), separators=(",", ":")) + "\n")
print(f"{len(codes)} stations matched out of {stores} TotalEnergies stores")
