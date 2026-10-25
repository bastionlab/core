"""Settings → Backup: the dashboard's own backups (agent/dash-backup does the work; this is the HTTP half).

GET /backup = schedule + list + whether a passphrase is set; POST /backup/settings, /backup/pass (write-only);
GET /backup/preview?name=; GET /backup/file?name= (download) and POST /backup/upload?name= (raw body) are
handled straight in agent.py because they are bytes, not JSON. Create and restore are actions (backup_create,
backup_restore).
"""
import json, os, re, subprocess, time
from pathlib import Path

from config import DASHBOARD

TOOL = f"{DASHBOARD}/agent/dash-backup"
SETTINGS = Path("/etc/dash/backup.json")
KEY = Path("/etc/dash/backup.key")
NAME_RE = re.compile(r"^dash-[a-z0-9-]{1,40}-\d{8}-\d{6}\.tar\.gz$")
MAX_UPLOAD = 4 << 30


def _tool(*args, stdin=None, timeout=120):
    r = subprocess.run(["python3", "-I", TOOL, *args], input=stdin, capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip()[-300:] or "dash-backup failed")
    return r.stdout


def _settings():
    try:
        return json.loads(SETTINGS.read_text())
    except (OSError, ValueError):
        return {}


def _dir():
    s = _settings()
    if s.get("storage"):
        r = subprocess.run(["pvesh", "get", f"/storage/{s['storage']}", "--output-format", "json"], capture_output=True, text=True, timeout=20)
        return Path(json.loads(r.stdout or "{}").get("path") or "/nonexistent") / "dash"
    return Path(s.get("dir") or "/var/lib/dash-backups")


def storages():
    """dir-like storages that can hold a file (vzdump content), for the target picker"""
    r = subprocess.run(["pvesh", "get", "/storage", "--output-format", "json"], capture_output=True, text=True, timeout=20)
    try:
        return [s["storage"] for s in json.loads(r.stdout) if s.get("path") and "backup" in str(s.get("content", ""))]
    except ValueError:
        return []


def view(q=None):
    s = _settings()
    return {"schedule": s.get("schedule") or "off", "keep": int(s.get("keep") or 7), "storage": s.get("storage") or "",
            "dir": str(_dir()), "pass_set": KEY.is_file() and KEY.stat().st_size > 0,
            "pass_updated": int(KEY.stat().st_mtime) if KEY.is_file() else None,
            "storages": storages(), "list": json.loads(_tool("list") or "[]")}


def set_settings(body):
    sched = str(body.get("schedule", "off"))
    if sched not in ("off", "daily", "weekly"):
        raise ValueError("schedule is off, daily or weekly")
    keep = int(body.get("keep") or 7)
    if not 1 <= keep <= 100:
        raise ValueError("keep 1-100")
    storage = str(body.get("storage") or "")
    if storage and storage not in storages():
        raise ValueError(f"{storage} is not a storage that holds backups")
    s = {**_settings(), "schedule": sched, "keep": keep, "storage": storage}
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS.with_name(".backup.json.tmp")
    tmp.write_text(json.dumps(s, indent=2))
    os.chmod(tmp, 0o644)
    tmp.replace(SETTINGS)
    return view()


def set_pass(body):
    pw = str(body.get("pass") or "")
    if len(pw) < 8:
        raise ValueError("at least 8 characters")
    _tool("set-pass", stdin=pw)
    return {"ok": True}


def name(q):
    n = str(q.get("name", ""))
    if not NAME_RE.match(n):
        raise ValueError("bad backup name")
    return n


def preview(q):
    return json.loads(_tool("preview", name(q), timeout=300))


def path(q):
    p = _dir() / name(q)
    if not p.is_file():
        raise ValueError("no such backup")
    return p


def upload(h, q):
    """the raw request body → <dir>/<name>; it must be a backup (manifest.json inside) or it is dropped"""
    n = name(q)
    size = int(h.headers.get("Content-Length") or 0)
    if not 0 < size <= MAX_UPLOAD:
        raise ValueError("empty or over 4 GB")
    d = _dir()
    d.mkdir(parents=True, exist_ok=True)
    dest = d / n
    if dest.exists():
        raise ValueError(f"{n} is there already")
    part = d / f".{n}.upload"
    left = size
    with part.open("wb") as f:
        while left:
            chunk = h.rfile.read(min(left, 1 << 20))
            if not chunk:
                break
            f.write(chunk)
            left -= len(chunk)
    os.chmod(part, 0o600)
    import tarfile
    try:
        if left:
            raise ValueError("upload cut short")
        with tarfile.open(part) as tf:
            m = json.loads(tf.extractfile("manifest.json").read())
        if m.get("format") != 1:
            raise ValueError("not a dashboard backup")
    except Exception as e:
        part.unlink(missing_ok=True)
        raise ValueError(f"not a dashboard backup ({e})"[:200])
    os.utime(part, (time.time(), m.get("created") or time.time()))
    part.replace(dest)
    return {"name": n}


def a_backup_create(args):
    s = _settings()
    return (f"back up the dashboard now (config, notes, chats, add-on data{', encrypted secrets' if KEY.is_file() else ''}) "
            f"into {_dir()}, keep the last {int(s.get('keep') or 7)}", ["python3", "-I", TOOL, "create"], 1800)


def a_backup_restore(args):
    n = name(args)
    p = preview({"name": n})
    parts = [i["where"] for i in p["items"] if i["ok"]]
    log = "/var/log/dash-rebuild.log"
    return (f"restore {n}: replace {'; '.join(parts)} (each old copy is kept as <path>.pre-restore-<time>), "
            f"then rebuild the dashboard (gone for a few minutes). Progress: {log}",
            ["systemd-run", "--unit", "dash-restore", "--collect", "--quiet", "-p", f"StandardOutput=append:{log}",
             "-p", f"StandardError=append:{log}", "-p", "RuntimeMaxSec=45min",
             "-E", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "python3", "-I", TOOL, "restore", n], 30)
