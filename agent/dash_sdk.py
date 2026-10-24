"""What an add-on's agent module (addons/<id>/agent/*.py) builds on, so it never hardcodes CT ids or
re-implements the plumbing:

    from dash_sdk import get, post, action, pct, sh, cached, ct, ip, CFG
    @get("/learn/job")
    def job(q): ...          # q = query dict; return something JSON-able, raise ValueError for a 400
    @post("/learn/start")
    def start(body): ...     # body = parsed JSON
    @post(r"/games/([a-z-]+)", regex=True)
    def do(body, m): ...     # m = the re.Match of the path
    @stream("/term/stream")
    def feed(h, q): ...      # h = the request handler: write server-sent events to h.wfile yourself
    @action("media_remove")
    def a(args): ...         # -> (description shown on Run, fixed argv, timeout seconds); validate everything
    services({"radarr": ("dl", "docker", "radarr")})   # what service_restart / service_uptime know about
    @on_start
    def reaper(): ...        # runs in a thread once the agent starts

The agent answers these next to its own routes, with the same token and allowlist. Only what an installed
add-on registers exists: removing the add-on removes its routes and actions on the next restart.
"""
import importlib.util, re, sys
from pathlib import Path

from config import CFG, DASHBOARD, DEVBOX, DEVBOX_IDS, DEVBOX_IPS, HOST_IP, ct, ip  # noqa: F401  (re-exported for add-ons)
from core import FAN, GH_TOKEN_FILE, GH_USER, GH_USER_FILE, POOL, PV, cached, http_json, invalidate, js, sh  # noqa: F401
from metrics import cts, unit  # noqa: F401
from claude import CLAUDE, _alive as alive, _cc_pid as unit_pid, _starttime as starttime  # noqa: F401

ROUTES: dict[tuple[str, str], callable] = {}
ROUTES_RE: list[tuple[str, re.Pattern, callable]] = []
STREAMS: dict[str, callable] = {}
ACTIONS: dict[str, callable] = {}
SERVICES: dict[str, tuple[int, str, str]] = {}
STARTUP: list[callable] = []
QUIET: set[str] = set()  # polled GET paths (or prefixes) the access log skips


def get(path, quiet=False, regex=False):
    def deco(fn):
        if regex:
            ROUTES_RE.append(("GET", re.compile(path), fn))
        else:
            ROUTES[("GET", path)] = fn
        if quiet:
            QUIET.add(path.split("(")[0])
        return fn
    return deco


def post(path, regex=False):
    def deco(fn):
        if regex:
            ROUTES_RE.append(("POST", re.compile(path), fn))
        else:
            ROUTES[("POST", path)] = fn
        return fn
    return deco


def stream(path):
    """a long-lived GET (server-sent events); the handler writes headers and data itself, see sse_start"""
    def deco(fn):
        STREAMS[path] = fn
        QUIET.add(path)
        return fn
    return deco


def sse_start(h):
    h.send_response(200)
    h.send_header("Content-Type", "text/event-stream")
    h.send_header("Cache-Control", "no-cache")
    h.send_header("X-Accel-Buffering", "no")
    h.end_headers()


def action(name):
    def deco(fn):
        ACTIONS[name] = fn
        return fn
    return deco


def services(entries: dict):
    """name -> (config.json cts key, "docker" | "systemd", container or unit); CTs this box lacks are skipped"""
    for name, (key, kind, ref) in entries.items():
        if ct(key):
            SERVICES[name] = (ct(key), kind, ref)


JOB_STALE: set[str] = set()


def stale_after_jobs(*names):
    """cached functions (by name) that may be out of date once any action finishes"""
    JOB_STALE.update(names)


def on_start(fn):
    STARTUP.append(fn)
    return fn


def route(method, path):
    """(fn, match) for a path an add-on registered, else (None, None)"""
    fn = ROUTES.get((method, path))
    if fn:
        return fn, None
    for m_, rx, f in ROUTES_RE:
        m = m_ == method and rx.fullmatch(path)
        if m:
            return f, m
    return None, None


def pct(name, *argv, timeout=20):
    """run argv inside the CT that config.json calls `name`"""
    return sh("pct", "exec", str(ct(name)), "--", *argv, timeout=timeout)


def load_addons(root: Path):
    """import every addons/<id>/agent/*.py once, under its own file name, so an add-on's modules can import each
    other (`from media import ...`) and get the same module; their decorators fill the registries above"""
    files = sorted(root.glob("*/agent/*.py"))
    for d in {f.parent for f in files}:
        if str(d) not in sys.path:
            sys.path.append(str(d))  # appended: a core module of the same name would win, so names must be unique
    for f in files:
        have = sys.modules.get(f.stem)
        if have is not None:
            if Path(getattr(have, "__file__", "") or "").resolve() != f.resolve():
                raise ImportError(f"add-on module {f} clashes with {getattr(have, '__file__', f.stem)}: rename it")
            continue
        importlib.import_module(f.stem)
