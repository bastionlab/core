"""What an add-on's agent module (addons/<id>/agent/*.py) builds on, so it never hardcodes CT ids or
re-implements the plumbing:

    from dash_sdk import get, post, pct, sh, cached, ct, ip, CFG
    @get("/learn/job")
    def job(q): ...          # q = query dict; return something JSON-able, raise ValueError for a 400
    @post("/learn/start")
    def start(body): ...     # body = parsed JSON

The agent answers these next to its own routes, with the same token and allowlist.
"""
import importlib.util, sys
from pathlib import Path

from config import CFG, ct, ip  # noqa: F401  (re-exported for add-ons)
from core import cached, invalidate, js, sh  # noqa: F401
from claude import CLAUDE, _alive as alive, _cc_pid as unit_pid, _starttime as starttime  # noqa: F401

ROUTES: dict[tuple[str, str], callable] = {}
QUIET: set[str] = set()  # polled GET paths the access log skips


def get(path, quiet=False):
    def deco(fn):
        ROUTES[("GET", path)] = fn
        if quiet:
            QUIET.add(path)
        return fn
    return deco


def post(path):
    def deco(fn):
        ROUTES[("POST", path)] = fn
        return fn
    return deco


def pct(name, *argv, timeout=20):
    """run argv inside the CT that config.json calls `name`"""
    return sh("pct", "exec", str(ct(name)), "--", *argv, timeout=timeout)


def load_addons(root: Path):
    """import every addons/<id>/agent/*.py once; their decorators fill ROUTES"""
    for f in sorted(root.glob("*/agent/*.py")):
        name = f"addon_{f.parent.parent.name}_{f.stem}"
        if name in sys.modules:
            continue
        spec = importlib.util.spec_from_file_location(name, f)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
