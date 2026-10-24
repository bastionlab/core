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


def ct(name: str) -> int:
    return int(CFG["cts"][name]["id"])


def ip(name: str) -> str:
    return CFG["cts"][name]["ip"]
