"""Add-ons page → Core: this core's version, the newest release on its channel with the changelog, update and
roll back (agent/core-update does the work; update and rollback are actions that run it in dash-rebuild)."""
import json, re, subprocess

from config import DASHBOARD
from core import cached, invalidate

TOOL = f"{DASHBOARD}/agent/core-update"
TAG_RE = re.compile(r"^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$")
LOG = "/var/log/dash-rebuild.log"


@cached(600)
def core_check():
    r = subprocess.run(["python3", "-I", TOOL, "check"], capture_output=True, text=True, timeout=90)
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip()[-300:])
    return json.loads(r.stdout)


def check():
    return core_check()


def fresh():
    invalidate("core_check")
    return core_check()


def set_channel(body):
    c = str(body.get("channel", ""))
    if c not in ("stable", "beta"):
        raise ValueError("stable or beta")
    subprocess.run(["python3", "-I", TOOL, "channel", c], check=True, capture_output=True, timeout=20)
    return fresh()


def _unit(*args):
    return ["systemd-run", "--unit", "dash-core-update", "--collect", "--quiet", "-p", f"StandardOutput=append:{LOG}",
            "-p", f"StandardError=append:{LOG}", "-p", "RuntimeMaxSec=45min",
            "-E", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "python3", "-I", TOOL, *args]


def a_core_update(args):
    tag = str(args.get("tag", ""))
    if not TAG_RE.match(tag):
        raise ValueError("tag must look like v1.2.3")
    c = check()
    if not c.get("latest") or c["latest"]["tag"] != tag:
        raise ValueError(f"{tag} is not the newest release on the {c.get('channel')} channel")
    if c.get("blocked"):
        raise ValueError("blocked: " + "; ".join(c["blocked"]))
    return (f"update the core {c['current']} → {tag[1:]} (this one is kept for rollback), then rebuild the dashboard "
            f"(gone for a few minutes). Progress: {LOG}", _unit("apply", tag), 30)


def a_core_rollback(args):
    c = check()
    if not c.get("rollback"):
        raise ValueError("no earlier core is kept")
    return (f"roll the core back from {c['current']} to {c['rollback'][0]}, then rebuild the dashboard. Progress: {LOG}",
            _unit("rollback"), 30)
