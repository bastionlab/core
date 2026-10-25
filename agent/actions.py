"""the action allowlist (the only things the dashboard and the Ask model can run) and the jobs that run them"""
import importlib.machinery, importlib.util, json, os, re, secrets, shlex, signal, subprocess, threading, time

import backup, release
from config import DASHBOARD, ct
from core import FAN, JOBS, JOBS_LOCK, cached, invalidate, sh
from metrics import backup_busy, cts, pools, scheduled_shutdown, unit


# Every action the dashboard (and through it the AI) may run: the host's own here, an add-on's in its agent module
# (dash_sdk.action; Dev's git/project/newdev, Media's media_remove, Local AI's ollama_pull/stop). Arguments are validated, argv is fixed:
# nothing the caller sends is ever passed to a shell. No CT destroy and no dataset/volume deletion. What does
# delete or power off is guarded: project_remove only moves the folder to ~/.pv-trash and refuses unpushed work,
# media_remove, host_shutdown and host_reboot sit behind a double confirm and are not offered to the Ask model.

# what service_restart / service_uptime know: name -> (CT, systemd or docker, unit or container)
SERVICES = {
    "dash": (ct("dash"), "systemd", "dash"),
    "immich": (ct("immich"), "docker", "immich_server"),
    "immich-ml": (ct("immich"), "docker", "immich_machine_learning"),
    "jellyfin": (ct("jellyfin"), "docker", "jellyfin"),
    "audiobookshelf": (ct("books"), "docker", "audiobookshelf"),
}
SERVICES = {k: v for k, v in SERVICES.items() if v[0]}  # a CT this box doesn't have (0) is not a service here


@cached(30)
def service_uptime():
    """state, start time and restart count of every SERVICES entry — one pct exec per container"""
    running = {c["vmid"] for c in cts() if c["status"] == "running"}
    by_ct = {}
    for name, (vmid, kind, ref) in _services().items():
        by_ct.setdefault(vmid, []).append((name, kind, ref))

    def one(vmid, items):
        if vmid not in running:
            return [{"name": n, "ct": vmid, "state": "ct-stopped", "since": None, "restarts": None} for n, _, _ in items]
        script = "\n".join(
            f"echo \"{n}|$(systemctl show {r} -p ActiveState --value)|$(systemctl show {r} -p ActiveEnterTimestamp --value)|$(systemctl show {r} -p NRestarts --value)\""
            if k == "systemd" else
            f"echo \"{n}|$(docker inspect -f '{{{{.State.Status}}}}|{{{{.State.StartedAt}}}}|{{{{.RestartCount}}}}' {r} 2>/dev/null || echo 'missing||')\""
            for n, k, r in items)
        out = []
        for line in sh(*_pct(vmid, "sh", "-c", script), timeout=15).splitlines():
            n, state, since, restarts = (line.split("|") + ["", "", ""])[:4]
            t = None
            if since:
                stamp = sh("date", "-d", since, "+%s").strip()
                t = int(stamp) if stamp.isdigit() and int(stamp) > 0 else None
            out.append({"name": n, "ct": vmid, "state": {"active": "running"}.get(state, state or "unknown"), "since": t,
                        "restarts": int(restarts) if restarts.isdigit() else None})
        return out

    futures = [FAN.submit(one, v, items) for v, items in by_ct.items()]
    return sorted((x for f in futures for x in f.result()), key=lambda x: (x["ct"], x["name"]))


def _ct(args, key="vmid", running=None):
    try:
        vmid = int(args[key])
    except (KeyError, TypeError, ValueError):
        raise ValueError("vmid must be a container id")
    c = next((c for c in cts() if c["vmid"] == vmid), None)
    if not c:
        raise ValueError(f"no container {vmid}")
    if running is True and c["status"] != "running":
        raise ValueError(f"CT {vmid} {c['name']} is not running")
    if running is False and c["status"] == "running":
        raise ValueError(f"CT {vmid} {c['name']} is already running")
    return c


def _pct(vmid, *cmd):
    return ["pct", "exec", str(vmid), "--", *cmd]


def _backup_ok():
    busy = backup_busy()
    if busy:
        raise ValueError("not now — " + "; ".join(busy))


VZDUMP = ["--storage", "vzdump", "--mode", "snapshot", "--compress", "zstd", "--notes-template", "{{guestname}} (dashboard)"]


def a_backup_ct(args):
    c = _ct(args)
    _backup_ok()
    return f"back up CT {c['vmid']} {c['name']} (vzdump, snapshot mode)", ["vzdump", str(c["vmid"]), *VZDUMP], 3 * 3600


def a_backup_all(args):
    """every guest, one after the other, like the nightly job. Snapshot mode: nothing is stopped or paused;
    bind mounts (the media and photo libraries on tank) are not part of it — sanoid/syncoid cover those."""
    _backup_ok()
    n = len(cts())
    return f"back up all {n} containers now (vzdump, snapshot mode — services keep running)", ["vzdump", "--all", "1", *VZDUMP], 4 * 3600


def a_ct_start(args):
    c = _ct(args, running=False)
    return f"start CT {c['vmid']} {c['name']}", ["pct", "start", str(c["vmid"])], 300


def a_ct_shutdown(args):
    c = _ct(args, running=True)
    return f"shut down CT {c['vmid']} {c['name']}", ["pct", "shutdown", str(c["vmid"]), "--timeout", "90"], 300


def a_ct_reboot(args):
    c = _ct(args, running=True)
    return f"reboot CT {c['vmid']} {c['name']}", ["pct", "reboot", str(c["vmid"]), "--timeout", "90"], 300


def a_host_shutdown(args):
    """power the whole machine off one minute from now — every container and the dashboard itself go with it.
    The minute is the undo window (host_shutdown_cancel). Not offered to the Ask model."""
    _backup_ok()
    if scheduled_shutdown():
        raise ValueError("a shutdown is already scheduled")
    n = sum(1 for c in cts() if c["status"] == "running")
    return (f"power off the pve host in 1 minute ({n} running containers are shut down first)",
            ["shutdown", "-P", "+1", "powered off from the dashboard"], 60)


def a_host_reboot(args):
    """restart the whole machine: in 1 minute, or at a time today/tonight (`at` = "HH:MM", host clock).
    Same undo as host_shutdown (host_shutdown_cancel). Not offered to the Ask model."""
    _backup_ok()
    if scheduled_shutdown():
        raise ValueError("a shutdown or reboot is already scheduled")
    at = str((args or {}).get("at") or "").strip()
    if at and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", at):
        raise ValueError("at must be HH:MM")
    n = sum(1 for c in cts() if c["status"] == "running")
    when = f"at {at}" if at else "in 1 minute"
    return (f"reboot the pve host {when} ({n} running containers stop and start again)",
            ["shutdown", "-r", at or "+1", "rebooted from the dashboard"], 60)


def a_host_shutdown_cancel(args):
    if not scheduled_shutdown():
        raise ValueError("no shutdown is scheduled")
    return "cancel the scheduled shutdown", ["shutdown", "-c"], 60


def a_service_restart(args):
    name = str(args.get("service", ""))
    svc = _services()
    if name not in svc:
        raise ValueError(f"unknown service {name}; known: {', '.join(sorted(svc))}")
    vmid, kind, ref = svc[name]
    _ct({"vmid": vmid}, running=True)
    cmd = ["systemctl", "restart", ref] if kind == "systemd" else ["docker", "restart", ref]
    return f"restart {name} in CT {vmid}", _pct(vmid, *cmd), 300


def a_apt_upgrade(args):
    target = args.get("target", "host")
    line = "apt-get update && apt-get -y -o Dpkg::Options::=--force-confold upgrade"
    if target == "host":
        return "upgrade packages on the pve host", ["sh", "-c", line], 3600
    c = _ct({"vmid": target}, running=True)
    return f"upgrade packages in CT {c['vmid']} {c['name']}", _pct(c["vmid"], "sh", "-c", line), 3600


def a_apt_upgrade_all(args):
    """host + every running container, one after the other. The script is built here from validated
    container ids only — nothing the caller sends reaches the shell."""
    ids = [c["vmid"] for c in cts() if c["status"] == "running" and c["type"] == "lxc"]
    line = "apt-get update && apt-get -y -o Dpkg::Options::=--force-confold upgrade"
    steps = [f'echo "=== pve host ==="; ({line}) || echo "host: FAILED"']
    for vmid in ids:
        name = next((c["name"] for c in cts() if c["vmid"] == vmid), "")
        steps.append(f'echo; echo "=== CT {vmid} {name} ==="; '
                     f'pct exec {vmid} -- sh -c {shlex.quote(line)} || echo "CT {vmid}: FAILED"')
    return (f"upgrade packages everywhere: the pve host and {len(ids)} running containers",
            ["sh", "-c", "; ".join(steps)], 4 * 3600)


def a_zfs_scrub(args):
    pool = str(args.get("pool", ""))
    if pool not in [p["name"] for p in pools()]:
        raise ValueError(f"unknown pool {pool}")
    return f"start a scrub of ZFS pool {pool}", ["zpool", "scrub", pool], 60


def a_unit_start(args):
    unit = str(args.get("unit", ""))
    if unit not in ("sanoid.service", "syncoid.service"):
        raise ValueError("only sanoid.service or syncoid.service")
    what = "take ZFS snapshots now" if unit.startswith("sanoid") else "replicate tank → backup pool now"
    return what, ["systemctl", "start", unit], 6 * 3600


# --- add-ons: install / update / remove from the marketplace (agent/addon-get does the work) ---------------
ADDON_GET = f"{DASHBOARD}/agent/addon-get"
_ag = None


def _addon_get():
    """addon-get as a module, for its index lookup and checks; the action itself runs it as a process"""
    global _ag
    if not _ag:
        loader = importlib.machinery.SourceFileLoader("addon_get", ADDON_GET)
        _ag = importlib.util.module_from_spec(importlib.util.spec_from_loader("addon_get", loader))
        loader.exec_module(_ag)
    return _ag


def _addon(args, cmd):
    ag = _addon_get()
    aid = str(args.get("id", ""))
    if not ag.ID_RE.match(aid):
        raise ValueError("bad add-on id")
    here = ag.ADDONS / aid
    rebuild = "then rebuilds the dashboard (it is gone for a few minutes)"
    if cmd == "remove":
        if not (here / "addon.yaml").exists():
            raise ValueError(f"{aid} is not an installed add-on folder")
        v = ag.manifest(here).get("version", "?")
        desc = f"remove the add-on {aid} {v} (moved to /var/lib/dash-addons/old, its CT and data stay), {rebuild}"
    else:
        e = next((a for a in ag.index()["addons"] if a.get("id") == aid), None)
        if not e:
            raise ValueError(f"{aid} is not in the marketplace")
        src = e.get("repo") or f"{(ag.MK.get('repo') or 'https://github.com/bastionlab/addons')}/{e.get('path') or aid}"
        if cmd == "install":
            if here.exists():
                raise ValueError(f"{aid} is already installed")
            desc = (f"install the add-on {e.get('name', aid)} {e.get('version')} by {e.get('author')} from {src} — "
                    f"its code runs as root on pve (install.sh, if it has one, runs now), {rebuild}")
            if e.get("license"):
                desc += f" — license {e['license']}"
            if e.get("warning"):
                desc += f" — ⚠ {e['warning']}"
        else:
            if not (here / "addon.yaml").exists():
                raise ValueError(f"{aid} is not installed")
            cur = ag.manifest(here).get("version")
            if not ag.newer(e.get("version"), cur):
                raise ValueError(f"{aid} is already at {cur}")
            desc = f"update the add-on {aid} {cur} → {e.get('version')} from {src} (old copy kept), {rebuild}"
    return desc, ["python3", "-I", ADDON_GET, cmd, aid], 3600


def a_addon_publish(args):
    """the Publish button: addons/<id> → a publish/<id> PR on the marketplace repo; GitHub checks it and merges"""
    ag = _addon_get()
    aid = str(args.get("id", ""))
    if not ag.ID_RE.match(aid) or not (ag.ADDONS / aid / "addon.yaml").exists():
        raise ValueError(f"{aid} is not an add-on folder here")
    state = marketplace_local().get(aid)
    if not state:
        raise ValueError(f"{aid} has no changes to publish")
    v = ag.manifest(ag.ADDONS / aid).get("version", "?")
    repo = ag.MK.get("repo") or "https://github.com/bastionlab/addons"
    what = "a new add-on" if state == "new" else f"changes to {v} (the version goes up if needed)"
    return (f"publish {aid}, {what}, to {repo}: GitHub checks it for malware, secrets, style and lint, then merges it "
            f"and every install gets it. Nothing merges if a check fails.",
            ["python3", "-I", f"{DASHBOARD}/agent/addon-publish", aid], 2400)


@cached(20)
def marketplace_local():
    """{id: "new" | "changed"}: add-ons here that differ from the marketplace (what Publish would send)"""
    return _addon_get().local_changes()


@cached(300)
def marketplace_index():
    """the marketplace index as addon-get sees it (with the token for a private repo); the app shows it from here"""
    return _addon_get().index()


@cached(1800)
def _scan(aid, version, installed):
    try:
        return _addon_get().preview(aid)
    except SystemExit as e:  # addon-get's helpers exit on a failed fetch; here that is an answer, not the end
        raise ValueError(str(e.code))


def marketplace_scan(aid):
    """the safety check of what Install / Update would bring (agent/addon_scan.py), per marketplace version"""
    ag = _addon_get()
    if not ag.ID_RE.match(aid):
        raise ValueError("bad add-on id")
    e = next((a for a in marketplace_index()["addons"] if a.get("id") == aid), None)
    if not e:
        raise ValueError(f"{aid} is not in the marketplace")
    here = ag.ADDONS / aid / "addon.yaml"
    return _scan(aid, e.get("version"), ag.manifest(here.parent).get("version") if here.exists() else None)


def a_config_set(args):
    """Settings → General: one config.json value, shown old → new on the Run button; config-set checks it again"""
    from config import config_change
    path = str(args.get("path", ""))
    old, new, _ = config_change(path, args.get("value"))
    return (f"set {path} from {json.dumps(old)} to {json.dumps(new)} in /etc/dash/config.json (old file kept), "
            f"then rebuild the dashboard (gone for a few minutes)",
            ["python3", "-I", f"{DASHBOARD}/agent/config-set", path, json.dumps(new)], 1800)


def a_dash_deploy(args):
    """the Deploy button (Settings, ⌘K): send the work to GitHub (agent/dash-ship: commit + release the core,
    publish changed add-ons) in its own unit. This box itself needs no deploy: agent/dash-live applies every edit.
    The job ends once it has started; GET /deploy follows the log. Not offered to the Ask model."""
    if subprocess.run(["systemctl", "is-active", "--quiet", "dash-rebuild"]).returncode == 0:
        raise ValueError("a deploy or rebuild is already running")
    log = "/var/log/dash-rebuild.log"
    return ("send the dashboard to GitHub: commit everything in /root/dashboard, tag a core release and push it, "
            f"publish every changed add-on (pull request, checks, merge). Every install can then update. Progress: {log}",
            ["systemd-run", "--unit", "dash-rebuild", "--collect", "--quiet", "-p", "RuntimeMaxSec=30min",
             "-E", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", f"{DASHBOARD}/agent/dash-ship"], 30)


def deploy_status():
    """GET /deploy: is one running, and the last run's log (from its start marker) — survives the agent restarting"""
    running = subprocess.run(["systemctl", "is-active", "--quiet", "dash-rebuild"]).returncode == 0
    try:
        lines = open("/var/log/dash-rebuild.log", errors="replace").read().splitlines()[-3000:]
    except OSError:
        lines = []
    start = max((i for i, l in enumerate(lines) if l.startswith("=== deploy start")), default=None)
    run = lines[start:] if start is not None else []
    end = next((l for l in run if l.startswith("=== deploy end")), None)
    m = re.match(r"=== deploy start (\d+)", run[0]) if run else None
    return {"running": running, "started": int(m.group(1)) if m else None,
            "rc": int(end.rsplit("rc=", 1)[1]) if end else None, "ended": int(end.split()[3]) if end else None,
            "log": [l for l in run[1:] if not l.startswith("===")][-60:], "live": _live()}


def _live():
    """agent/dash-live: what the last automatic apply did (state watching|applying|ok|failed, msg, files, at)"""
    try:
        return json.load(open("/var/lib/dash-live/status.json"))
    except (OSError, ValueError):
        return None


def a_secrets_rotate(args):
    """Settings → Secrets: new internal tokens; secrets-rotate runs in dash-rebuild because it restarts the agent"""
    log = "/var/log/dash-rebuild.log"
    return ("make new internal tokens (agent, LAN key, Deals, Money; old ones kept as .old), redeploy Deals, Money "
            "and the dashboard (gone for a few minutes, every browser enters the PIN again; old tokens come back if a "
            f"step fails). Progress: {log}",
            ["systemd-run", "--unit", "dash-rebuild", "--collect", "--quiet", "-p", f"StandardOutput=append:{log}",
             "-p", f"StandardError=append:{log}", "-p", "RuntimeMaxSec=45min",
             f"{DASHBOARD}/agent/secrets-rotate"], 30)


def a_addon_install(args):
    return _addon(args, "install")


def a_addon_update(args):
    return _addon(args, "update")


def a_addon_remove(args):
    return _addon(args, "remove")


ACTIONS = {
    "backup_ct": a_backup_ct, "backup_all": a_backup_all, "ct_start": a_ct_start, "ct_shutdown": a_ct_shutdown, "ct_reboot": a_ct_reboot,
    "service_restart": a_service_restart, "apt_upgrade": a_apt_upgrade,
    "apt_upgrade_all": a_apt_upgrade_all, "zfs_scrub": a_zfs_scrub,
    "unit_start": a_unit_start, 
"host_shutdown": a_host_shutdown, "host_shutdown_cancel": a_host_shutdown_cancel, "host_reboot": a_host_reboot,
    # not offered to the Ask model (server/utils/actions.ts): only the Add-ons page's own buttons run these
    "addon_install": a_addon_install, "addon_update": a_addon_update, "addon_remove": a_addon_remove,
    "addon_publish": a_addon_publish,
    "config_set": a_config_set, "secrets_rotate": a_secrets_rotate, "dash_deploy": a_dash_deploy,
    "backup_create": backup.a_backup_create, "backup_restore": backup.a_backup_restore,
    "core_update": release.a_core_update, "core_rollback": release.a_core_rollback,
}

MAX_LOG = 400


def _actions():
    """the core's actions plus those installed add-ons registered with dash_sdk.action"""
    import dash_sdk
    return {**ACTIONS, **dash_sdk.ACTIONS}


def _services():
    import dash_sdk
    return {**SERVICES, **dash_sdk.SERVICES}


def check_action(name, args):
    """validate without running — returns the human-readable description"""
    fn = _actions().get(name)
    if not fn:
        raise ValueError(f"unknown action {name}")
    return fn(dict(args or {}))[0]


def _log(job, line):
    with JOBS_LOCK:
        job["log"].append(line.rstrip()[:500])
        del job["log"][:-MAX_LOG]


def _run_job(job, argv, timeout):
    killer = None
    try:
        # own process group, so a timeout takes the whole tree (pct exec, apt, ...) and not just the first child
        p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, start_new_session=True)
        job["pid"] = p.pid

        def kill():
            _log(job, f"agent: timed out after {timeout}s, killed")
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if timeout:
            killer = threading.Timer(timeout, kill)
            killer.daemon = True
            killer.start()
        for line in p.stdout:
            _log(job, line)
        job["rc"] = p.wait()
    except Exception as e:
        _log(job, f"agent: {e}")
        job["rc"] = -1
    finally:
        if killer:
            killer.cancel()
        job["done"] = int(time.time())
        import dash_sdk
        invalidate("updates", "ct_ports", "overview", "service_uptime", *dash_sdk.JOB_STALE)


def start_action(name, args):
    acts = _actions()
    if name not in acts:
        raise ValueError(f"unknown action {name}")
    desc, argv, timeout = acts[name](dict(args or {}))
    now = int(time.time())
    job = {"id": f"{now}-{secrets.token_hex(3)}", "action": name, "args": args, "desc": desc,
           "argv": argv, "started": now, "done": None, "rc": None, "log": []}
    with JOBS_LOCK:
        JOBS[job["id"]] = job
        # drop the oldest finished jobs; running ones stay so backup_busy and the status poll still see them
        done = sorted((j for j in JOBS.values() if j["done"]), key=lambda j: j["started"])
        for old in done[:max(0, len(JOBS) - 40)]:
            JOBS.pop(old["id"], None)
    threading.Thread(target=_run_job, args=(job, argv, timeout), daemon=True).start()
    return job_view(job)


def job_view(job):
    with JOBS_LOCK:
        return {k: (list(v) if k == "log" else v) for k, v in job.items() if k != "pid"}


def job_status(job_id):
    job = JOBS.get(str(job_id))
    if not job:
        raise ValueError("unknown job")
    return job_view(job)
