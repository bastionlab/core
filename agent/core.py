"""shared plumbing for the agent modules: shell helpers, the result cache, thread pools, paths"""
import json, subprocess, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from config import DEVBOX


HERE = Path(__file__).resolve().parent
TSKEY = DEVBOX / "keys/tailscale_authkey"
TSKEY_DAYS = 90
PV = "/usr/local/bin/pv"
POOL = ThreadPoolExecutor(8)
# leaf work fanned out from inside a POOL task (per-CT probes, *arr calls) runs here: a POOL task waiting on
# its own pool could take every worker and hang /overview for good
FAN = ThreadPoolExecutor(16)
GH_TOKEN_FILE = DEVBOX / "keys/github_token"
GH_USER_FILE = DEVBOX / "keys/github_user"
GH_USER = ""  # fallback when keys/github_user is missing: no public-repo listing


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
_gen = {}  # per cache key: bumped by invalidate() so a refresh already running can't store its older result


def invalidate(*names):
    """drop cached results by function name — an action just changed what they measured"""
    with _lock:
        for k in [k for k in _cache if k[0] in names]:
            del _cache[k]
        for k in [k for k in _gen if k[0] in names]:
            _gen[k] += 1


def cached(ttl, stale=0):
    """memoise by args for ttl seconds; with stale=N an entry up to N seconds old is returned at once while one
    background thread refreshes it (so slow calls never block a request after the first)"""
    def deco(fn):
        busy = set()

        def run(key, a):
            with _lock:
                gen = _gen.setdefault(key, 0)
            try:
                val = fn(*a)
                with _lock:
                    if _gen.get(key, 0) == gen:
                        _cache[key] = (time.time(), val)
                return val
            finally:
                with _lock:
                    busy.discard(key)

        def wrap(*a):
            key = (fn.__name__, a)
            with _lock:
                hit = _cache.get(key)
                age = time.time() - hit[0] if hit else None
                if hit and age < ttl:
                    return hit[1]
                if hit and age < ttl + stale:
                    if key not in busy:
                        busy.add(key)
                        threading.Thread(target=run, args=(key, a), daemon=True).start()
                    return hit[1]
            return run(key, a)
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
