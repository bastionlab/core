"""this install's own values (tailnet, LAN, CT ids and IPs, paths) from /etc/dash/config.json, so no module hardcodes
them. config.example.json in the repo shows the shape and is the fallback on a box that has none yet."""
import json
from pathlib import Path

_FILE = Path("/etc/dash/config.json")
CFG = json.loads((_FILE if _FILE.exists() else Path(__file__).resolve().parent.parent / "config.example.json").read_text())

TAILNET = CFG["tailnet"]
HOST_IP = CFG["lan"]["host_ip"]
DASH_URL = f"https://dash.{TAILNET}"
DASHBOARD = CFG["paths"]["dashboard"]
DEVBOX = Path(CFG["paths"]["devbox"])
DEVBOX_IDS = tuple(CFG["devbox"]["ids"])
DEVBOX_IPS = tuple(CFG["devbox"]["ips"])


# a fresh install has only some of these CTs: a missing one is 0 / "" (the add-on using it starts switched off)
# rather than a KeyError that would stop the whole agent from starting
def ct(name: str) -> int:
    return int(CFG["cts"].get(name, {}).get("id") or 0)


def ip(name: str) -> str:
    return CFG["cts"].get(name, {}).get("ip") or ""


# --- editing (Settings → General; the config_set action and agent/config-set) --------------------------------
import copy, ipaddress, re as _re

_DOMAIN = _re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")
_EMAIL = _re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CTKEY = _re.compile(r"^[a-z][a-z0-9-]{1,20}$")


def _ip(v):
    return str(ipaddress.ip_address(str(v).strip()))


def _url(v):
    v = str(v or "").strip()
    if v and not _re.match(r"^https?://\S+$", v):
        raise ValueError("an http(s) URL, or empty")
    return v


def _check(path, v):
    """the paths Settings may change, each with its own check; returns the value as it will be stored"""
    p = path.split(".")
    if path == "name":
        v = str(v).strip()
        if not 1 <= len(v) <= 30:
            raise ValueError("1-30 characters")
        return v
    if path == "tailnet":
        v = str(v).strip().lower()
        if not _DOMAIN.match(v):
            raise ValueError("a tailnet name like tail1234.ts.net")
        return v
    if path == "owner_logins":
        v = [s.strip() for s in (v if isinstance(v, list) else str(v).split(",")) if s.strip()]
        if not v or not all(_EMAIL.match(s) for s in v):
            raise ValueError("one or more logins (e-mail addresses), comma-separated")
        return v
    if path == "lan.subnet":
        return str(ipaddress.ip_network(str(v).strip(), strict=False))
    if path == "lan.host_ip":
        return _ip(v)
    if path == "devbox.ids":
        lo, hi = [int(x) for x in (v if isinstance(v, list) else str(v).split("-"))]
        if not 100 <= lo <= hi <= 999999:
            raise ValueError("a range like 200-299")
        return [lo, hi]
    if path == "devbox.ips":
        a, b = [_ip(x) for x in (v if isinstance(v, list) else str(v).split("-"))]
        return [a, b]
    if len(p) == 3 and p[0] == "cts" and _CTKEY.match(p[1]) and p[2] in ("id", "ip"):
        if p[2] == "id":
            n = int(v)
            if not 100 <= n <= 999999:
                raise ValueError("a CT id (100-999999)")
            return n
        return _ip(v)
    if path in ("marketplace.index", "marketplace.repo", "marketplace.counter"):
        return _url(v)
    if path == "marketplace.share_installs":
        return v in (True, "true", "1", 1, "on")
    raise ValueError(f"{path} can't be changed from the dashboard")


def config_change(path, value, cfg=None):
    """(old, new, the whole new config) — nothing is written here"""
    cfg = copy.deepcopy(cfg if cfg is not None else CFG)
    new = _check(str(path), value)
    *parents, last = str(path).split(".")
    node = cfg
    for k in parents:
        node = node.setdefault(k, {})
        if not isinstance(node, dict):
            raise ValueError(f"{path} is not a setting")
    old = node.get(last)
    node[last] = new
    return old, new, cfg
