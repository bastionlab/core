"""Settings: what each add-on asks for (addon.yaml `settings:`), the core's own connections (GitHub, Tailscale,
Discord, Claude) and this install's config.json — the agent's half of the /settings page.

Values an add-on declares go to /etc/dash/settings/<addon>.json; the ones marked `secret: true` to
/etc/dash/secrets/<addon>.json (root only). Secrets are write-only from the dashboard: it learns whether one is
set and when, never the value. Add-on agent modules read theirs with dash_sdk.setting() / secret().
"""
import hashlib, hmac, json, os, re, subprocess, threading, time, urllib.request
from pathlib import Path

from config import CFG, DASHBOARD, DEVBOX, ct
from core import cached

ROOT = Path(__file__).resolve().parent.parent / "addons"
VALUES = Path("/etc/dash/settings")
SECRETS = Path("/etc/dash/secrets")
ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
TYPES = ("text", "number", "toggle", "select", "url", "secret")


# --- add-on fields --------------------------------------------------------------------------------------------
def _manifests():
    import yaml  # python3-yaml; only needed here
    out = {}
    for f in sorted(ROOT.glob("*/addon.yaml")):
        try:
            m = yaml.safe_load(f.read_text()) or {}
        except Exception:
            continue
        if ID_RE.match(str(m.get("id", ""))):
            out[m["id"]] = m
    return out


def _fields(m):
    fields = []
    for s in m.get("settings") or []:
        if not isinstance(s, dict) or not KEY_RE.match(str(s.get("key", ""))):
            continue
        t = s.get("type", "text")
        if s.get("secret"):
            t = "secret"
        fields.append({"key": s["key"], "label": str(s.get("label") or s["key"]), "type": t if t in TYPES else "text",
                       "help": s.get("help"), "options": s.get("options"), "default": s.get("default"),
                       "min": s.get("min"), "max": s.get("max")})
    return fields


def _read(d: Path, aid):
    try:
        return json.loads((d / f"{aid}.json").read_text())
    except (OSError, ValueError):
        return {}


def _write(d: Path, aid, data, mode):
    d.mkdir(parents=True, exist_ok=True)
    os.chmod(d, 0o700 if d == SECRETS else 0o755)
    tmp = d / f".{aid}.json.tmp"
    tmp.write_text(json.dumps(data, indent=2))
    os.chmod(tmp, mode)
    tmp.replace(d / f"{aid}.json")


def values(aid):
    """an add-on's non-secret settings with defaults filled in (what its web/server code reads)"""
    if not ID_RE.match(aid or ""):
        raise ValueError("bad add-on id")
    m = _manifests().get(aid)
    if not m:
        raise ValueError(f"{aid} is not installed")
    have = _read(VALUES, aid)
    return {f["key"]: have.get(f["key"], f["default"]) for f in _fields(m) if f["type"] != "secret"}


def setting(aid, key, default=None):
    return _read(VALUES, aid).get(key, default)


def secret(aid, key):
    return (_read(SECRETS, aid).get(key) or {}).get("value")


def _coerce(f, v):
    t = f["type"]
    if t == "toggle":
        return bool(v)
    if t == "number":
        try:
            n = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"{f['label']}: a number")
        if (f["min"] is not None and n < f["min"]) or (f["max"] is not None and n > f["max"]):
            raise ValueError(f"{f['label']}: between {f['min']} and {f['max']}")
        return int(n) if n == int(n) else n
    v = str(v if v is not None else "").strip()
    if len(v) > 4000:
        raise ValueError(f"{f['label']}: too long")
    if t == "select":
        opts = [str(o.get("value") if isinstance(o, dict) else o) for o in f["options"] or []]
        if v not in opts:
            raise ValueError(f"{f['label']}: one of {', '.join(opts)}")
    if t == "url" and v and not re.match(r"^https?://[^\s]+$", v):
        raise ValueError(f"{f['label']}: an http(s) URL")
    return v


def set_value(aid, key, value):
    """POST /settings/set — one field of one add-on; an empty secret clears it"""
    if not ID_RE.match(aid or "") or not KEY_RE.match(key or ""):
        raise ValueError("bad add-on or key")
    m = _manifests().get(aid)
    if not m:
        raise ValueError(f"{aid} is not installed")
    f = next((f for f in _fields(m) if f["key"] == key), None)
    if not f:
        raise ValueError(f"{aid} has no setting {key}")
    v = _coerce(f, value)
    if f["type"] == "secret":
        s = _read(SECRETS, aid)
        if v:
            s[key] = {"value": v, "updated": int(time.time())}
        else:
            s.pop(key, None)
        _write(SECRETS, aid, s, 0o600)
    else:
        d = _read(VALUES, aid)
        d[key] = v
        _write(VALUES, aid, d, 0o644)
    return {"ok": True}


# --- the core's connections ----------------------------------------------------------------------------------
GH_TOKEN = DEVBOX / "keys/github_token"
TS_KEY = DEVBOX / "keys/tailscale_authkey"
TS_KEY_DAYS = 90


@cached(600)
def _github():
    try:
        t = GH_TOKEN.read_text().strip()
    except OSError:
        return {"ok": False, "detail": "no token"}
    try:
        req = urllib.request.Request("https://api.github.com/user", headers={"Authorization": f"token {t}", "User-Agent": "pvedash"})
        with urllib.request.urlopen(req, timeout=10) as r:
            user = json.loads(r.read()).get("login")
            scopes = r.headers.get("X-OAuth-Scopes") or "fine-grained"
            exp = r.headers.get("GitHub-Authentication-Token-Expiration")
        return {"ok": True, "detail": f"{user} · {scopes}", "expires": exp}
    except Exception as e:
        return {"ok": False, "detail": f"rejected by GitHub ({e.__class__.__name__})"}


def core_connections():
    import hooks
    from claude import claude_usage
    out = []
    gh = _github()
    out.append({"id": "github", "name": "GitHub token", "used_by": "Dev, marketplace, add-on installs", **gh,
                "updated": int(GH_TOKEN.stat().st_mtime) if GH_TOKEN.exists() else None, "set": "github_token"})
    if TS_KEY.exists():
        made = TS_KEY.stat().st_mtime
        left = int((made + TS_KEY_DAYS * 86400 - time.time()) / 86400)
        out.append({"id": "tailscale", "name": "Tailscale auth key", "used_by": "new dev boxes", "ok": left > 0,
                    "detail": f"{left} days left" if left > 0 else "expired", "expires": int(made + TS_KEY_DAYS * 86400),
                    "warn": 0 < left <= 14, "set": "tailscale_authkey"})
    else:
        out.append({"id": "tailscale", "name": "Tailscale auth key", "used_by": "new dev boxes", "ok": False,
                    "detail": "not set", "set": "tailscale_authkey"})
    ch = hooks.view()["channels"]
    n = sum(c["set"] for c in ch)
    out.append({"id": "discord", "name": "Discord webhooks", "used_by": "alerts, Deals, Flats, Jobs, Money",
                "ok": n == len(ch), "warn": 0 < n < len(ch), "detail": f"{n} of {len(ch)} channels"})
    try:
        u = claude_usage()
        ok = u.get("status") != "rejected"
        out.append({"id": "claude", "name": "Claude login", "used_by": "Chat, Ask bar, Learn", "ok": ok,
                    "detail": "signed in" + (" · limit reached" if not ok else ""), "fix": "claude /login in a terminal on pve"})
    except Exception as e:
        out.append({"id": "claude", "name": "Claude login", "ok": False, "detail": str(e)[:120], "fix": "claude /login in a terminal on pve"})
    return out


def set_core(key, value):
    """POST /settings/core — the two host keys the core keeps in /root/devbox/keys (write-only, like secrets)"""
    v = str(value or "").strip()
    if key == "github_token":
        if not re.fullmatch(r"(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,120})", v):
            raise ValueError("that is not a GitHub token (ghp_… or github_pat_…)")
        f = GH_TOKEN
    elif key == "tailscale_authkey":
        if not re.fullmatch(r"tskey-(auth-)?[A-Za-z0-9-]{10,120}", v):
            raise ValueError("that is not a Tailscale auth key (tskey-…)")
        f = TS_KEY
    else:
        raise ValueError("unknown key")
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f".{f.name}.tmp")
    tmp.write_text(v + "\n")
    os.chmod(tmp, 0o600)
    tmp.replace(f)
    from core import invalidate
    invalidate("_github", "github_repos", "marketplace_index")
    return {"ok": True}


# --- the PIN -------------------------------------------------------------------------------------------------
PIN_HASH = Path(DASHBOARD) / "agent/pin_hash"
_pin_fails = []


def _scrypt(pin, salt):
    return hashlib.scrypt(pin.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)


def set_pin(current, new):
    """POST /settings/pin — what ./set-pin does, from the page: needs the current PIN; the app restarts with the new
    hash (every browser logs in again). 5 wrong current PINs in 10 minutes lock it for the rest of them."""
    now = time.time()
    _pin_fails[:] = [t for t in _pin_fails if now - t < 600]
    if len(_pin_fails) >= 5:
        raise ValueError("too many wrong PINs, try again in 10 minutes")
    cur, new = str(current or ""), str(new or "")
    _, salt, want = PIN_HASH.read_text().strip().split(":")
    if not hmac.compare_digest(_scrypt(cur, bytes.fromhex(salt)).hex(), want):
        _pin_fails.append(now)
        raise ValueError("current PIN is wrong")
    if not re.fullmatch(r"[0-9]{4,12}", new):
        raise ValueError("new PIN: 4-12 digits")
    salt = os.urandom(16)
    line = f"scrypt:{salt.hex()}:{_scrypt(new, salt).hex()}"
    tmp = PIN_HASH.with_name(".pin_hash.tmp")
    tmp.write_text(line + "\n")
    os.chmod(tmp, 0o600)
    tmp.replace(PIN_HASH)
    # same env line deploy.sh writes; a restart (not a rebuild) is enough, it is read at runtime
    subprocess.run(["pct", "exec", str(ct("dash")), "--", "sh", "-c",
                    "umask 077; sed -i '/^NUXT_PIN_HASH=/d' /etc/dash.env; cat >> /etc/dash.env"],
                   input=f"NUXT_PIN_HASH={line}\n", text=True, check=True, timeout=30)
    # after this answer has gone back through the app
    threading.Timer(1.5, lambda: subprocess.run(["pct", "exec", str(ct("dash")), "--", "systemctl", "restart", "dash"],
                                                timeout=60)).start()
    return {"ok": True}


# --- what secrets exist where (never their values) -----------------------------------------------------------
BACK = Path((CFG.get("paths") or {}).get("backends") or "/root")
OLD_DAYS = 180


def _file(name, path: Path, used_by, rotate=None):
    st = path.stat() if path.exists() else None
    age = int((time.time() - st.st_mtime) / 86400) if st else None
    return {"name": name, "where": str(path), "used_by": used_by, "set": bool(st and st.st_size),
            "updated": int(st.st_mtime) if st else None, "old": age is not None and age > OLD_DAYS, "rotate": rotate}


def inventory():
    a = Path(DASHBOARD) / "agent"
    out = [_file("Dashboard PIN", a / "pin_hash", "login (hash only)", "pin"),
           _file("Agent token", a / "token", "app ↔ agent", "tokens"),
           _file("LAN key", a / "lan_key", "Caddy ↔ app (home network)", "tokens")]
    for b, used in (("deals", "app ↔ Deals/Flats/Jobs"), ("money", "app ↔ Money")):
        if (BACK / b / "token").exists():
            out.append(_file(f"{b.capitalize()} API token", BACK / b / "token", used, "tokens"))
    used = {"github_token": ("GitHub token", "Dev, marketplace", "github_token"),
            "tailscale_authkey": ("Tailscale auth key", "new dev boxes", "tailscale_authkey"),
            "github_ed25519": ("GitHub SSH key", "git on dev boxes", None)}
    for f in sorted((DEVBOX / "keys").glob("*")):
        if f.is_file() and not f.name.endswith(".pub"):
            n, u, r = used.get(f.name, (f.name, "dev boxes", None))
            out.append(_file(n, f, u, r))
    out.append(_file("Discord webhooks", Path("/etc/dash/discord.json"), "alerts + add-ons", "discord"))
    out.append(_file("Claude login", Path("/root/.claude/.credentials.json"), "Chat, Ask bar, Learn"))
    m = _manifests()
    for aid in sorted(m):
        sec = _read(SECRETS, aid)
        for f in _fields(m[aid]):
            if f["type"] == "secret":
                s = sec.get(f["key"]) or {}
                up = s.get("updated")
                out.append({"name": f["label"], "where": f"{SECRETS}/{aid}.json", "used_by": m[aid].get("name", aid),
                            "set": bool(s.get("value")), "updated": up, "rotate": f"addon:{aid}",
                            "old": bool(up and time.time() - up > OLD_DAYS * 86400)})
    return out


# --- everything the page shows -------------------------------------------------------------------------------
CONFIG_VIEW = ("name", "tailnet", "owner_logins", "lan", "devbox", "cts", "marketplace")


def view():
    addons = {}
    for aid, m in _manifests().items():
        fields = _fields(m)
        if not fields:
            continue
        have, sec = _read(VALUES, aid), _read(SECRETS, aid)
        for f in fields:
            if f["type"] == "secret":
                s = sec.get(f["key"]) or {}
                f["set"], f["updated"] = bool(s.get("value")), s.get("updated")
            else:
                f["value"] = have.get(f["key"], f["default"])
        addons[aid] = {"name": m.get("name", aid), "fields": fields}
    cfg = {k: CFG.get(k) for k in CONFIG_VIEW}
    if isinstance(cfg.get("marketplace"), dict):
        cfg["marketplace"] = {k: v for k, v in cfg["marketplace"].items() if k != "token"}
    return {"connections": core_connections(), "addons": addons, "config": cfg, "secrets": inventory()}
