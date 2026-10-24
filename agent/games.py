"""game servers in CT 110 (gameservers): a thin, validated bridge to `gsm` inside the CT"""
import json, re

from core import cached, invalidate, sh

CT = 110
GSM = "/usr/local/bin/gsm"
ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,23}")
BACKUP_RE = re.compile(r"\d{8}-\d{6}\.tar\.zst")
VERSION_RE = re.compile(r"latest|\d+\.\d+\.\d+")


def _gsm(*args, timeout=60):
    raw = sh("pct", "exec", str(CT), "--", GSM, *args, timeout=timeout)
    try:
        return json.loads(raw.strip().splitlines()[-1])
    except Exception:
        return {"error": (raw.strip()[-300:] or "gsm did not answer")}


def _id(v):
    v = str(v or "")
    if not ID_RE.fullmatch(v):
        raise ValueError("bad server id")
    return v


def _ct_status():
    out = sh("pct", "status", str(CT), timeout=10)
    return out.split(":", 1)[1].strip() if ":" in out else "missing"


@cached(4)
def games():
    st = _ct_status()
    if st != "running":
        return {"ct": CT, "ctStatus": st, "servers": [], "templates": []}
    return {"ct": CT, "ctStatus": st, **_gsm("list", timeout=40)}


def games_log(sid, n=300):
    return _gsm("logs", _id(sid), str(max(10, min(int(n), 2000))), timeout=25)


def games_do(action, body):
    """POST /games/<action>: every argument is checked here before it reaches the CT"""
    sid = body.get("id")
    if action == "create":
        tpl = str(body.get("template") or "")
        if not re.fullmatch(r"[a-z0-9]{1,24}", tpl):
            raise ValueError("bad template")
        settings = body.get("settings") or {}
        if not isinstance(settings, dict):
            raise ValueError("bad settings")
        r = _gsm("create", tpl, _id(sid), str(body.get("name") or "")[:40], json.dumps(settings))
    elif action == "set":
        settings = body.get("settings") or {}
        if not isinstance(settings, dict):
            raise ValueError("bad settings")
        r = _gsm("set", _id(sid), json.dumps(settings), "1" if body.get("apply") else "0")
    elif action in ("start", "stop", "restart", "backup", "remove"):
        r = _gsm(action, _id(sid), timeout=320)
    elif action == "restore":
        f = str(body.get("file") or "")
        if not BACKUP_RE.fullmatch(f):
            raise ValueError("bad backup name")
        r = _gsm("restore", _id(sid), f)
    elif action == "update":
        v = str(body.get("version") or "latest")
        if not VERSION_RE.fullmatch(v):
            raise ValueError("bad version")
        r = _gsm("update", _id(sid), v)
    elif action == "cmd":
        c = str(body.get("command") or "")
        if not c.strip() or len(c) > 200 or "\n" in c or "\r" in c:
            raise ValueError("bad command")
        r = _gsm("cmd", _id(sid), c, timeout=40)
    elif action == "playit":
        r = _gsm("playit-claim")
    elif action == "ct-start":
        sh("pct", "start", str(CT), timeout=60)
        r = {"ok": True}
    else:
        raise ValueError("unknown action")
    invalidate("games")
    if r.get("error"):
        raise ValueError(r["error"])
    return r
