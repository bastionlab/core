"""the action allowlist (the only things the dashboard and the Ask model can run) and the jobs that run them"""
import json, os, re, secrets, shlex, signal, subprocess, threading, time

from config import DEVBOX_IDS, DEVBOX_IPS, ct
from core import FAN, GH_NEW, GH_TOKEN_FILE, JOBS, JOBS_LOCK, PV, cached, invalidate, sh
from metrics import backup_busy, cts, pools, scheduled_shutdown, unit
from media import a_media_remove
from dev import checked_project, dev_cts, pv
from github import _gh_user


# Every action the dashboard (and through it the AI) may run. Arguments are validated here, argv is fixed:
# nothing the caller sends is ever passed to a shell. No CT destroy and no dataset/volume deletion. What does
# delete or power off is guarded: project_remove only moves the folder to ~/.pv-trash and refuses unpushed work,
# media_remove and host_shutdown sit behind a double confirm and are not offered to the Ask model.

# what service_restart / service_uptime know: name -> (CT, systemd or docker, unit or container)
SERVICES = {
    "dash": (ct("dash"), "systemd", "dash"),
    "ollama": (ct("ai"), "systemd", "ollama"),
    "open-webui": (ct("ai"), "systemd", "open-webui"),
    "searxng": (ct("ai"), "docker", "searxng"),
    "immich": (ct("immich"), "docker", "immich_server"),
    "immich-ml": (ct("immich"), "docker", "immich_machine_learning"),
    "jellyfin": (ct("jellyfin"), "docker", "jellyfin"),
    "audiobookshelf": (ct("books"), "docker", "audiobookshelf"),
    # download stack (CT 106). Restarting gluetun drops the network namespace
    # that qbittorrent, prowlarr and flaresolverr share; media-vpn-sync.service
    # on CT 106 re-attaches them automatically, so restarting it here is safe.
    "seerr": (ct("dl"), "docker", "seerr"),
    "qbittorrent": (ct("dl"), "docker", "qbittorrent"),
    "prowlarr": (ct("dl"), "docker", "prowlarr"),
    "radarr": (ct("dl"), "docker", "radarr"),
    "sonarr": (ct("dl"), "docker", "sonarr"),
    "bazarr": (ct("dl"), "docker", "bazarr"),
    "lazylibrarian": (ct("dl"), "docker", "lazylibrarian"),
    "gluetun": (ct("dl"), "docker", "gluetun"),
    "subgen": (ct("ai"), "docker", "subgen"),
}
AI_CT = ct("ai")


@cached(30)
def service_uptime():
    """state, start time and restart count of every SERVICES entry — one pct exec per container"""
    running = {c["vmid"] for c in cts() if c["status"] == "running"}
    by_ct = {}
    for name, (vmid, kind, ref) in SERVICES.items():
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


def a_host_shutdown_cancel(args):
    if not scheduled_shutdown():
        raise ValueError("no shutdown is scheduled")
    return "cancel the scheduled shutdown", ["shutdown", "-c"], 60


def a_service_restart(args):
    name = str(args.get("service", ""))
    if name not in SERVICES:
        raise ValueError(f"unknown service {name}; known: {', '.join(sorted(SERVICES))}")
    vmid, kind, ref = SERVICES[name]
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


def _dev_project(args):
    """a running dev box plus one of the projects `pv ls` reports in it"""
    try:
        vmid = int(args["vmid"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("vmid must be a dev container id")
    path = str(args.get("path", ""))
    checked_project(vmid, path)
    name = next((c["name"] for c in cts() if c["vmid"] == vmid), vmid)
    return vmid, path, name


def a_git_push(args):
    vmid, path, name = _dev_project(args)
    msg = str(args.get("message", "")).strip()
    if msg and (len(msg) > 200 or "\n" in msg):
        raise ValueError("commit message must be one line, max 200 characters")
    short = path.rsplit("/", 1)[-1]
    if msg:
        return f"commit everything in {short} as “{msg}” and push it to GitHub ({name})", \
            _pct(vmid, PV, "push", path, msg), 600
    return f"push the committed work in {short} to GitHub ({name})", _pct(vmid, PV, "push", path), 600


def a_git_fetch(args):
    vmid, path, name = _dev_project(args)
    return f"fetch {path.rsplit('/', 1)[-1]} from GitHub ({name})", _pct(vmid, PV, "fetch", path), 300


def a_project_new(args):
    try:
        vmid = int(args["vmid"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("vmid must be a dev container id")
    if not any(c["vmid"] == vmid and c["status"] == "running" for c in dev_cts()):
        raise ValueError(f"CT {vmid} is not a running dev box")
    name = str(args.get("name", ""))
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,40}", name):
        raise ValueError("project name: letters, digits, dot, dash, underscore")
    repo = str(args.get("repo", "")).strip()
    box = next((c["name"] for c in cts() if c["vmid"] == vmid), vmid)
    if repo:
        if not re.fullmatch(r"(?:git@[\w.-]+:[\w.-]+/[\w.-]+|https://[\w.-]+/[\w.-]+/[\w.-]+)(?:\.git)?", repo):
            raise ValueError("repo must be git@host:owner/name or https://host/owner/name")
        return f"clone {repo} into ~/Projects/GitHub/{name} on {box}", _pct(vmid, PV, "new", name, repo), 1800
    if args.get("github"):
        if not GH_TOKEN_FILE.exists():
            raise ValueError("creating repos on GitHub needs a token (repo scope) in /root/devbox/keys/github_token")
        vis = _visibility(args)
        return (f"create ~/Projects/GitHub/{name} on {box}, create the {vis} GitHub repo {_gh_user()}/{name} and push it",
                ["python3", GH_NEW, "new", str(vmid), name, vis], 1800)
    return f"create a new git project ~/Projects/GitHub/{name} on {box}", _pct(vmid, PV, "new", name), 600


def _visibility(args):
    vis = str(args.get("visibility", "private"))
    if vis not in ("private", "public"):
        raise ValueError("visibility must be private or public")
    return vis


def a_github_publish(args):
    """an existing project that has no remote yet: create the repo on GitHub and push it there"""
    vmid, path, _box = _dev_project(args)
    if not GH_TOKEN_FILE.exists():
        raise ValueError("creating repos on GitHub needs a token (repo scope) in /root/devbox/keys/github_token")
    name = str(args.get("name") or path.rstrip("/").split("/")[-1])
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,40}", name):
        raise ValueError("repo name: letters, digits, dot, dash, underscore")
    vis = _visibility(args)
    box = next((c["name"] for c in cts() if c["vmid"] == vmid), vmid)
    return (f"create the {vis} GitHub repo {_gh_user()}/{name} and push {path} on {box} to it",
            ["python3", GH_NEW, "publish", str(vmid), path, name, vis], 1800)


def a_project_remove(args):
    """Destructive, so the description the owner reads on the Run button must be exact: it names the box,
    the project and whether anything would be lost. `pv rm` itself refuses unpushed work unless forced,
    and moves the project to ~/.pv-trash rather than deleting it."""
    vmid, path, box = _dev_project(args)
    short = path.rstrip("/").rsplit("/", 1)[-1]
    force = bool(args.get("force"))
    bits = []
    try:
        pr = next((x for x in json.loads(pv(vmid, "ls", "--json")) if x["path"] == path), None)
        g = (pr or {}).get("git") or {}
        if g.get("dirty"):
            bits.append(f"{g['dirty']} uncommitted change(s)")
        if not g.get("repo"):
            bits.append("no GitHub remote")
        elif g.get("ahead"):
            bits.append(f"{g['ahead']} unpushed commit(s)")
    except Exception:
        pass
    # A model asked to "delete X" sets force=true by reflex, so the Run button — the only thing the owner
    # actually reads — has to say what forcing costs, in front, instead of a parenthesis at the end.
    if force and bits:
        desc = (f"FORCE: remove {short} from {box} (CT {vmid}) although it has {' and '.join(bits)} — "
                f"that work exists nowhere else and would live on only as the ~/.pv-trash copy")
    elif force:
        desc = f"remove the project {short} from {box} (CT {vmid}) (clean and pushed) — it is moved to ~/.pv-trash, not deleted"
    else:
        state = f" ({', '.join(bits)}, so this will be refused — push it first)" if bits else " (clean and pushed)"
        desc = f"remove the project {short} from {box} (CT {vmid}){state} — it is moved to ~/.pv-trash, not deleted"
    return desc, _pct(vmid, PV, "rm", path, *(["--force"] if force else [])), 600


MODEL_RE = re.compile(r"^[a-zA-Z0-9][\w.:/-]{0,80}$")


def a_ollama_pull(args):
    model = str(args.get("model", ""))
    if not MODEL_RE.match(model):
        raise ValueError("invalid model name")
    return f"download the Ollama model {model} (can take a while)", _pct(AI_CT, "ollama", "pull", model), 4 * 3600


def a_ollama_stop(args):
    model = str(args.get("model", ""))
    if not MODEL_RE.match(model):
        raise ValueError("invalid model name")
    return f"unload {model} from VRAM (the model stays on disk)", _pct(AI_CT, "ollama", "stop", model), 120


def a_newdev(args):
    vmid, name, ip = args.get("vmid"), str(args.get("name", "")), str(args.get("ip", ""))
    try:
        vmid = int(vmid)
    except (TypeError, ValueError):
        raise ValueError("vmid must be a number")
    lo, hi = DEVBOX_IDS
    if not lo <= vmid <= hi:
        raise ValueError(f"dev boxes use ids {lo}-{hi}")
    if any(c["vmid"] == vmid for c in cts()):
        raise ValueError(f"CT {vmid} already exists")
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,20}", name):
        raise ValueError("name must be lowercase letters, digits and dashes")
    net, first = DEVBOX_IPS[0].rsplit(".", 1)
    last = DEVBOX_IPS[1].rsplit(".", 1)[1]
    m = re.fullmatch(re.escape(net) + r"\.(\d{1,3})", ip)
    if not m or not int(first) <= int(m[1]) <= int(last):
        raise ValueError(f"ip must be {net}.{first}-{last}")
    if any(c["ip"] == ip for c in cts()):
        raise ValueError(f"{ip} is already used")
    return f"create dev box CT {vmid} {name} at {ip} (newdev, several minutes)", ["/usr/local/bin/newdev", str(vmid), name, ip], 3 * 3600


ACTIONS = {
    "backup_ct": a_backup_ct, "backup_all": a_backup_all, "ct_start": a_ct_start, "ct_shutdown": a_ct_shutdown, "ct_reboot": a_ct_reboot,
    "service_restart": a_service_restart, "apt_upgrade": a_apt_upgrade,
    "apt_upgrade_all": a_apt_upgrade_all, "zfs_scrub": a_zfs_scrub,
    "unit_start": a_unit_start, "ollama_pull": a_ollama_pull, "ollama_stop": a_ollama_stop, "newdev": a_newdev,
    "git_push": a_git_push, "git_fetch": a_git_fetch, "project_new": a_project_new,
    "github_publish": a_github_publish, "project_remove": a_project_remove,
    "media_remove": a_media_remove, "host_shutdown": a_host_shutdown, "host_shutdown_cancel": a_host_shutdown_cancel,
}

MAX_LOG = 400


def check_action(name, args):
    """validate without running — returns the human-readable description"""
    fn = ACTIONS.get(name)
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
        invalidate("updates", "ct_ports", "overview", "media_items", "media", "media_sizes", "service_uptime")


def start_action(name, args):
    if name not in ACTIONS:
        raise ValueError(f"unknown action {name}")
    desc, argv, timeout = ACTIONS[name](dict(args or {}))
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
