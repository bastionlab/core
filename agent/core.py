"""shared plumbing for the agent modules: shell helpers, the result cache, thread pools, paths"""
import json, subprocess, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from config import DASHBOARD, DEVBOX


HERE = Path(__file__).resolve().parent
TSKEY = DEVBOX / "keys/tailscale_authkey"
TSKEY_DAYS = 90
PV = "/usr/local/bin/pv"
GH_NEW = f"{DASHBOARD}/agent/gh-new"
POOL = ThreadPoolExecutor(8)
# leaf work fanned out from inside a POOL task (per-CT probes, *arr calls) runs here: a POOL task waiting on
# its own pool could take every worker and hang /overview for good
FAN = ThreadPoolExecutor(16)
GH_TOKEN_FILE = DEVBOX / "keys/github_token"
GH_USER_FILE = DEVBOX / "keys/github_user"
GH_USER = "MaxJC0"


def sh(*args, timeout=20):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.stdout
    except Exception:
        return ""


def js(*args, timeout=20, default=None):
    try:
        return json.loads(sh(*args, timeout=timeout))
    except Exception:
        return default


_cache, _lock = {}, threading.Lock()


def invalidate(*names):
    """drop cached results by function name — an action just changed what they measured"""
    with _lock:
        for k in [k for k in _cache if k[0] in names]:
            del _cache[k]


def cached(ttl):
    def deco(fn):
        def wrap(*a):
            key = (fn.__name__, a)
            with _lock:
                hit = _cache.get(key)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
            val = fn(*a)
            with _lock:
                _cache[key] = (time.time(), val)
            return val
        wrap.__name__ = fn.__name__
        return wrap
    return deco


JOBS, JOBS_LOCK = {}, threading.Lock()  # dashboard action jobs (actions.py); backup_busy reads them too


def http_json(url, headers=None, timeout=15, data=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    try:
        return json.loads(body)
    except Exception:
        return None
