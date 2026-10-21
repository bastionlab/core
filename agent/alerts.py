#!/usr/bin/env python3
"""Host alerts → #alerts on Discord: failed backups and full disks. Runs every 15 min (dash-alerts.timer).
Each problem pings once, again after a day if it's still there, and once more when it's gone."""
import json, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hooks  # noqa: E402

STATE = Path("/var/lib/dash/alerts.json")
FULL = 90  # %
REMIND = 86400
BACKUP_HOUR_SLACK = 30 * 3600  # nightly job at 23:00: nothing finished for 30 h = it didn't run


def js(*args):
    try:
        return json.loads(subprocess.run(args, capture_output=True, text=True, timeout=60).stdout or "null")
    except (ValueError, subprocess.TimeoutExpired):
        return None


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=60).stdout


def problems(state):
    """{key: message} for everything wrong right now"""
    out = {}
    # backups: every vzdump task that ended badly since we last looked, and the nightly job going quiet
    tasks = js("pvesh", "get", "/nodes/pve/tasks", "--typefilter", "vzdump", "--limit", "20", "--output-format", "json") or []
    seen = state.get("_task_seen", time.time() - 86400)
    for t in tasks:
        if t.get("endtime") and t["endtime"] > seen and t.get("status") != "OK":
            when = time.strftime("%d.%m. %H:%M", time.localtime(t["endtime"]))
            out[f"task:{t['upid']}"] = f"💾 Backup fehlgeschlagen ({when}): `{t.get('status')}`" + \
                                        (f" – CT {t['id']}" if t.get("id") else "")
    if tasks:
        state["_task_seen"] = max([seen] + [t.get("endtime") or 0 for t in tasks])
    jobs = js("pvesh", "get", "/cluster/backup", "--output-format", "json") or []
    last_ok = max([t["endtime"] for t in tasks if t.get("status") == "OK" and t.get("endtime")] or [0])
    if any(j.get("enabled", 1) for j in jobs) and time.time() - last_ok > BACKUP_HOUR_SLACK:
        ago = f"seit {(time.time() - last_ok) / 3600:.0f} h" if last_ok else "noch nie"
        out["backup:stale"] = f"💾 Kein erfolgreiches nächtliches Backup {ago}"
    for log in Path("/var/log/vzdump").glob("lxc-*.log"):
        text = log.read_text(errors="replace")
        err = next((l.split("ERROR: ", 1)[1] for l in text.splitlines() if "ERROR: " in l), None)
        if err and time.time() - log.stat().st_mtime < 2 * 86400:
            out[f"ct-backup:{log.stem}"] = f"💾 Backup von CT {log.stem[4:]} mit Fehler: `{err[:180]}`"
    for u in ("sanoid.service", "syncoid.service"):
        if sh("systemctl", "is-failed", u).strip() == "failed":
            out[f"unit:{u}"] = f"💾 `{u}` ist fehlgeschlagen (ZFS-Snapshots/Replikation) – `journalctl -u {u}`"
    # disks: pools, storages, every CT's root disk
    for line in sh("zpool", "list", "-Hp", "-o", "name,health").splitlines():
        name, health = line.split("\t")
        if health != "ONLINE":
            out[f"pool:{name}"] = f"🛑 ZFS-Pool **{name}** ist {health} – `zpool status {name}`"
    for s in js("pvesh", "get", "/nodes/pve/storage", "--output-format", "json") or []:
        if s.get("total") and 100 * s["used"] / s["total"] >= FULL:
            out[f"storage:{s['storage']}"] = f"🗄️ Speicher **{s['storage']}** ist zu {100 * s['used'] / s['total']:.0f} % voll " \
                                             f"({(s['total'] - s['used']) / 1e9:.0f} GB frei)"
    for c in js("pvesh", "get", "/nodes/pve/lxc", "--output-format", "json") or []:
        if c.get("status") == "running" and c.get("maxdisk") and 100 * c["disk"] / c["maxdisk"] >= FULL:
            out[f"ct:{c['vmid']}"] = f"🗄️ CT {c['vmid']} **{c.get('name')}**: Disk zu {100 * c['disk'] / c['maxdisk']:.0f} % voll"
    df = sh("df", "-P", "/").splitlines()[-1].split()
    if int(df[4].rstrip("%")) >= FULL:
        out["root"] = f"🗄️ pve `/` ist zu {df[4]} voll"
    return out


def main():
    try:
        state = json.loads(STATE.read_text())
    except (OSError, ValueError):
        state = {}
    open_ = state.setdefault("open", {})
    now_problems = problems(state)
    for k, msg in now_problems.items():
        o = open_.get(k)
        if not o or time.time() - o["sent"] > REMIND:
            if hooks.send("alerts", msg if not o else f"{msg} *(noch immer)*"):
                open_[k] = {"msg": msg, "sent": time.time()}
    for k in list(open_):
        # one-off task failures stay closed after their ping; conditions that clear get an all-clear
        if k not in now_problems and not k.startswith("task:"):
            if hooks.send("alerts", f"✅ Wieder in Ordnung: {open_[k]['msg']}"):
                del open_[k]
        elif k.startswith("task:") and time.time() - open_[k]["sent"] > 7 * 86400:
            del open_[k]
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state))


if __name__ == "__main__":
    main()
