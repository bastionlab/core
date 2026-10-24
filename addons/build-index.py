#!/usr/bin/env python3
"""Rebuilds addons/index.json, the marketplace index, from every addons/<id>/addon.yaml.

This folder is a stand-in for the future pvedash/addons repo: one folder per add-on plus this index at the root.
Entries that point at someone's own repo ("repo" set, no folder here) are kept as they are.
Run after changing an addon.yaml: python3 addons/build-index.py
"""
import json, time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
OUT = HERE / "index.json"
KEYS = ("id", "name", "icon", "version", "author", "desc", "routes", "needs", "ct", "depends_on")

old = json.loads(OUT.read_text()) if OUT.exists() else {"addons": []}
local = {}
for f in sorted(HERE.glob("*/addon.yaml")):
    m = yaml.safe_load(f.read_text())
    local[m["id"]] = {k: m[k] for k in KEYS if m.get(k) not in (None, [], "")} | {"path": f.parent.name}
external = [a for a in old["addons"] if a.get("repo") and a["id"] not in local]
out = {"format": 1, "updated": int(time.time()), "addons": sorted([*local.values(), *external], key=lambda a: a["id"])}
OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
print(f"{OUT}: {len(local)} here, {len(external)} in their own repos")
