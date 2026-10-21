#!/usr/bin/env python3
"""pve dashboard agent — read-only host data plus a fixed set of dev-preview actions.

Serves JSON to the dashboard CT only (source IP + bearer token). It never runs caller-supplied
commands: previews go through `pv` inside a CT tagged `dev`, for a project path that `pv ls` listed.
"""
import base64, fcntl, json, os, pty, re, secrets, select, shlex, shutil, signal, struct, subprocess, termios, threading, tty, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

HERE = Path(__file__).resolve().parent
BIND = os.environ.get("AGENT_BIND", "192.168.1.50")
PORT = int(os.environ.get("AGENT_PORT", "7070"))
ALLOW = set(os.environ.get("AGENT_ALLOW", "192.168.1.50,192.168.1.50").split(","))
TOKEN = (HERE / "token").read_text().strip()
TSKEY = Path("/root/devbox/keys/tailscale_authkey")
TSKEY_DAYS = 90
PV = "/usr/local/bin/pv"
GH_NEW = "/root/dashboard/agent/gh-new"
POOL = ThreadPoolExecutor(8)
GH_TOKEN_FILE = Path("/root/devbox/keys/github_token")
GH_USER_FILE = Path("/root/devbox/keys/github_user")
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


# --- host -------------------------------------------------------------------
_cpu_prev = None


def cpu_percent():
    global _cpu_prev
    vals = list(map(int, Path("/proc/stat").read_text().split("\n", 1)[0].split()[1:]))
    idle, total = vals[3] + vals[4], sum(vals)
    prev, _cpu_prev = _cpu_prev, (idle, total)
    if not prev or total == prev[1]:
        return None
    return round(100 * (1 - (idle - prev[0]) / (total - prev[1])), 1)


def host():
    st = js("pvesh", "get", "/nodes/pve/status", "--output-format", "json", default={})
    mem = st.get("memory", {})
    sensors = js("sensors", "-j", default={}) or {}
    temps = {}
    for chip, label, key in (("coretemp-isa-0000", "Package id 0", "cpu"), ("nvme-pci-0200", "Composite", "nvme")):
        try:
            temps[key] = round(sensors[chip][label]["temp1_input"], 1)
        except Exception:
            pass
    return {
        "name": "pve",
        "cpu": cpu_percent(),
        "cpus": st.get("cpuinfo", {}).get("cpus"),
        "cpuModel": st.get("cpuinfo", {}).get("model"),
        "load": [float(x) for x in st.get("loadavg", [])],
        "uptime": st.get("uptime"),
        "mem": {"used": mem.get("total", 0) - mem.get("available", 0), "total": mem.get("total")},
        "temps": temps,
        "pveVersion": st.get("pveversion"),
        "kernel": os.uname().release,
        "shutdown": scheduled_shutdown(),
    }


def scheduled_shutdown():
    """a pending `shutdown +N` — systemd-logind writes USEC= and MODE= here until it fires or is cancelled"""
    try:
        kv = dict(l.split("=", 1) for l in Path("/run/systemd/shutdown/scheduled").read_text().split() if "=" in l)
        return {"at": int(kv["USEC"]) // 1_000_000, "mode": kv.get("MODE", "poweroff")}
    except Exception:
        return None


def gpu():
    q = sh("nvidia-smi", "--query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu,power.draw",
           "--format=csv,noheader,nounits").strip()
    if not q:
        return None
    name, used, total, temp, util, power = [x.strip() for x in q.split("\n")[0].split(",")]
    procs = []
    for line in sh("nvidia-smi", "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits").splitlines():
        pid, pname, mem = [x.strip() for x in line.split(",")]
        procs.append({"pid": int(pid), "name": os.path.basename(pname), "mem": int(mem) * 2**20, "ct": ct_of_pid(pid)})
    num = lambda x: float(x) if re.match(r"^[\d.]+$", x) else None
    return {"name": name, "memUsed": int(used) * 2**20, "memTotal": int(total) * 2**20,
            "temp": num(temp), "util": num(util), "power": num(power), "procs": procs}


def ct_of_pid(pid):
    try:
        m = re.search(r"/lxc/(\d+)/", Path(f"/proc/{pid}/cgroup").read_text())
        return int(m[1]) if m else None
    except Exception:
        return None


# --- storage & backups -------------------------------------------------------
def pools():
    out = []
    for line in sh("zpool", "list", "-Hp", "-o", "name,size,alloc,free,health,frag,cap").splitlines():
        name, size, alloc, free, health, frag, cap = line.split("\t")
        st = sh("zpool", "status", name)
        scan = re.search(r"scan: (.*)", st)
        errors = re.search(r"errors: (.*)", st)
        when = re.search(r" on (\w{3} \w{3} +\d+ [\d:]+ \d{4})$", scan[1].strip()) if scan else None
        try:
            scrubbed = int(time.mktime(time.strptime(when[1], "%a %b %d %H:%M:%S %Y"))) if when else None
        except ValueError:
            scrubbed = None
        out.append({"name": name, "size": int(size), "alloc": int(alloc), "free": int(free), "health": health,
                    "frag": int(frag.rstrip("%") or 0), "scan": scan[1].strip() if scan else None, "scrubbed": scrubbed,
                    "errors": errors[1].strip() if errors else None})
    return out


def datasets():
    out = []
    for line in sh("zfs", "list", "-Hp", "-o", "name,used,avail,mountpoint", "-r", "tank").splitlines():
        name, used, avail, mp = line.split("\t")
        out.append({"name": name, "used": int(used), "avail": int(avail), "mountpoint": mp})
    return out


def snapshots():
    """newest snapshot per dataset → sanoid (tank) and syncoid (backup/tank) freshness"""
    latest = {}
    for line in sh("zfs", "list", "-Hp", "-t", "snapshot", "-o", "name,creation", "-s", "creation").splitlines():
        name, created = line.split("\t")
        ds, snap = name.split("@", 1)
        latest[ds] = {"snap": snap, "time": int(created)}
    return latest


def unit(name):
    out = sh("systemctl", "show", name, "-p", "Result", "-p", "ActiveState")
    d = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    timers = js("systemctl", "list-timers", "--all", "--output=json", default=[]) or []
    t = next((t for t in timers if t.get("activates") == name), {})
    sec = lambda v: v // 10**6 if v else None
    return {"result": d.get("Result"), "state": d.get("ActiveState"), "last": sec(t.get("last")), "next": sec(t.get("next"))}


def backups(cts):
    content = js("pvesh", "get", "/nodes/pve/storage/vzdump/content", "--output-format", "json", default=[]) or []
    per = {}
    for b in content:
        v = b.get("vmid")
        if v and b.get("ctime", 0) > per.get(v, {}).get("time", 0):
            per[v] = {"time": b["ctime"], "size": b.get("size"), "count": 0}
    for b in content:
        if b.get("vmid") in per:
            per[b["vmid"]]["count"] += 1
    snaps = snapshots()
    jobs = js("pvesh", "get", "/cluster/backup", "--output-format", "json", default=[]) or []
    tasks = js("pvesh", "get", "/nodes/pve/tasks", "--typefilter", "vzdump", "--limit", "14", "--output-format", "json",
               default=[]) or []
    return {
        "vzdump": [{"vmid": c["vmid"], "name": c["name"], **per.get(c["vmid"], {"time": None, "size": None, "count": 0}),
                    "run": vzdump_run(c["vmid"])} for c in cts],
        "history": [{"time": t.get("starttime"), "end": t.get("endtime"), "status": t.get("status"), "id": t.get("id") or None}
                    for t in tasks],
        "vzdumpJobs": [{"schedule": j.get("schedule"), "enabled": j.get("enabled", 1), "storage": j.get("storage"),
                        "all": j.get("all")} for j in jobs],
        "busy": backup_busy(),
        "sanoid": {**unit("sanoid.service"),
                   "datasets": [{"name": k, **v} for k, v in sorted(snaps.items()) if k.startswith("tank")]},
        "syncoid": {**unit("syncoid.service"),
                    "datasets": [{"name": k, **v} for k, v in sorted(snaps.items()) if k.startswith("backup/")]},
    }


def vzdump_run(vmid):
    """how the last vzdump of this guest ended — its log in /var/log/vzdump is rewritten on every run,
    so a failed run shows up here even though the previous good archive is still listed"""
    f = Path(f"/var/log/vzdump/lxc-{vmid}.log")
    if not f.exists():
        return None
    text = f.read_text(errors="replace")
    err = next((l.split("ERROR: ", 1)[1] for l in text.splitlines() if "ERROR: " in l), None)
    return {"time": int(f.stat().st_mtime), "ok": err is None and "Finished Backup" in text, "error": err and err[:200]}


def _wear(d):
    """percent of rated life used (SSD/NVMe) and the counters that predict a dying disk"""
    nv = d.get("nvme_smart_health_information_log")
    if nv:
        return {"wear": nv.get("percentage_used"), "spare": nv.get("available_spare"), "mediaErrors": nv.get("media_errors"),
                "critical": nv.get("critical_warning")}
    attrs = {a["id"]: a for a in d.get("ata_smart_attributes", {}).get("table", [])}
    raw = lambda i: attrs[i]["raw"]["value"] if i in attrs else None
    life = next((attrs[i]["value"] for i in (231, 233, 177, 202) if i in attrs), None)  # normalised: 100 = new
    return {"wear": 100 - life if life is not None else None, "realloc": raw(5), "pending": raw(197),
            "uncorrectable": raw(198), "crc": raw(199)}


def _disk_warn(x):
    out = []
    if x.get("passed") is False:
        out.append("SMART self-assessment FAILED")
    for k, what in (("realloc", "reallocated sectors"), ("pending", "pending sectors"),
                    ("uncorrectable", "uncorrectable sectors"), ("mediaErrors", "media errors")):
        if x.get(k):
            out.append(f"{x[k]} {what}")
    if x.get("critical"):
        out.append(f"NVMe critical warning {x['critical']}")
    if x.get("wear") is not None and x["wear"] >= 80:
        out.append(f"{x['wear']}% of rated life used")
    if x.get("spare") is not None and x["spare"] < 20:
        out.append(f"spare blocks at {x['spare']}%")
    if (x.get("temp") or 0) >= (70 if x["dev"].startswith("nvme") else 50):
        out.append(f"running hot ({x['temp']}°C)")
    return out


@cached(3600)
def smart():
    out = []
    for dev in sorted(Path("/dev").glob("sd?")) + sorted(Path("/dev").glob("nvme?n1")):
        d = js("smartctl", "-j", "-a", str(dev), default={}) or {}
        out.append({"dev": dev.name, "model": d.get("model_name"), "passed": d.get("smart_status", {}).get("passed"),
                    "temp": d.get("temperature", {}).get("current"), "hours": d.get("power_on_time", {}).get("hours"),
                    "size": d.get("user_capacity", {}).get("bytes"), **_wear(d)})
        out[-1]["warn"] = _disk_warn(out[-1])
    return out


# --- containers ---------------------------------------------------------------
def cts():
    res = js("pvesh", "get", "/cluster/resources", "--type", "vm", "--output-format", "json", default=[]) or []
    out = []
    for r in sorted(res, key=lambda r: r["vmid"]):
        conf = Path(f"/etc/pve/lxc/{r['vmid']}.conf")
        ip = None
        if conf.exists():
            m = re.search(r"^net0:.*ip=([\d.]+)", conf.read_text(), re.M)
            ip = m[1] if m else None
        out.append({"vmid": r["vmid"], "name": r.get("name"), "type": r["type"], "status": r.get("status"),
                    "tags": [t for t in (r.get("tags") or "").split(";") if t], "ip": ip,
                    "cpu": r.get("cpu"), "cpus": r.get("maxcpu"), "mem": r.get("mem"), "maxmem": r.get("maxmem"),
                    "disk": r.get("disk"), "maxdisk": r.get("maxdisk"), "uptime": r.get("uptime")})
    return out


def parse_ss(text):
    out = []
    for line in text.splitlines():
        cols = line.split()
        if len(cols) < 5:
            continue
        addr, port = cols[3].rsplit(":", 1)
        proc = re.search(r'users:\(\("([^"]+)"', line)
        out.append({"addr": addr.strip("[]"), "port": int(port), "proc": proc[1].split()[0] if proc else None})
    # collapse v4/v6 duplicates of the same port+proc
    seen, uniq = {}, []
    for p in out:
        k = (p["port"], p["proc"])
        local = p["addr"] in ("127.0.0.1", "::1") or p["addr"].startswith("127.")
        if k in seen:
            seen[k]["local"] = seen[k]["local"] and local
            continue
        seen[k] = {**p, "local": local}
        uniq.append(seen[k])
    return sorted(uniq, key=lambda p: p["port"])


def parse_serve(data, host):
    out = []
    for hostport, v in ((data or {}).get("Web") or {}).items():
        for path, h in (v.get("Handlers") or {}).items():
            out.append({"url": f"https://{hostport}{'' if path == '/' else path}", "target": h.get("Proxy") or h.get("Path"),
                        "host": host})
    funnel = (data or {}).get("AllowFunnel") or {}
    for s in out:
        s["public"] = any(s["url"].startswith("https://" + k) for k in funnel if funnel[k])
    return out


@cached(30)
def ct_ports(vmid):
    ss = sh("pct", "exec", str(vmid), "--", "ss", "-tlnpH", timeout=10)
    serve = js("pct", "exec", str(vmid), "--", "sh", "-c", "command -v tailscale >/dev/null && tailscale serve status --json",
               timeout=10, default=None)
    return {"listen": parse_ss(ss), "serve": parse_serve(serve, vmid)}


def ports(ctlist):
    running = [c for c in ctlist if c["status"] == "running" and c["type"] == "lxc"]
    res = dict(zip([c["vmid"] for c in running], POOL.map(lambda c: ct_ports(c["vmid"]), running)))
    host = {"listen": parse_ss(sh("ss", "-tlnpH")),
            "serve": parse_serve(js("tailscale", "serve", "status", "--json", default=None), "pve")}
    return {"host": host, "cts": {str(k): v for k, v in res.items()}}


@cached(3600)
def updates(vmid=None):
    cmd = ["apt", "list", "--upgradable"]
    out = sh(*cmd) if vmid is None else sh("pct", "exec", str(vmid), "--", *cmd, timeout=30)
    pkgs = [l.split("/", 1)[0] for l in out.splitlines() if "/" in l and "upgradable" in l]
    return {"count": len(pkgs), "packages": pkgs[:30], "checked": int(time.time())}


def all_updates(ctlist):
    running = [c["vmid"] for c in ctlist if c["status"] == "running" and c["type"] == "lxc"]
    res = dict(zip(running, POOL.map(updates, running)))
    return {"host": updates(), "cts": {str(k): v for k, v in res.items()}}


def tailnet():
    st = js("tailscale", "status", "--json", default={}) or {}
    nodes = []
    for n in [st.get("Self", {})] + list((st.get("Peer") or {}).values()):
        if not n:
            continue
        seen = n.get("LastSeen")
        nodes.append({"name": n.get("HostName"), "dns": (n.get("DNSName") or "").rstrip("."), "os": n.get("OS"),
                      "ip": (n.get("TailscaleIPs") or [None])[0], "online": n.get("Online") or n is st.get("Self"),
                      "self": n is st.get("Self"), "tags": n.get("Tags") or [],
                      "lastSeen": None if not seen or seen.startswith("0001") else seen,
                      "keyExpiry": n.get("KeyExpiry"), "routes": n.get("PrimaryRoutes") or []})
    key = None
    if TSKEY.exists():
        created = TSKEY.stat().st_mtime
        key = {"created": int(created), "expires": int(created + TSKEY_DAYS * 86400)}
    return {"tailnet": st.get("MagicDNSSuffix"), "nodes": nodes, "authKey": key}


# --- media stack (CT 106 "dl") ----------------------------------------------
MEDIA_CT = 106
MEDIA_IP = "192.168.1.56"
MEDIA_ROOT = Path("/tank/medien")
# app -> (port, api version, root folder the app owns)
ARR = {"radarr": (7878, "v3"), "sonarr": (8989, "v3"), "prowlarr": (9696, "v1")}
QB = (8080, "admin")
LL_PORT = 5299


def http_json(url, headers=None, timeout=15, data=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    try:
        return json.loads(body)
    except Exception:
        return None


@cached(1800)
def media_keys():
    """API keys stay on the host: read out of CT 106's configs, never sent to the dashboard"""
    keys = {}
    for app in ("radarr", "sonarr", "prowlarr"):
        m = re.search(r"<ApiKey>([^<]+)</ApiKey>",
                      sh("pct", "exec", str(MEDIA_CT), "--", "cat", f"/opt/media/{app}/config.xml", timeout=15))
        if m:
            keys[app] = m[1]
    m = re.search(r"^api_key\s*=\s*(\S+)", sh("pct", "exec", str(MEDIA_CT), "--", "cat",
                                                "/opt/media/lazylibrarian/config.ini", timeout=15), re.M)
    if m:
        keys["lazylibrarian"] = m[1]
    pw = sh("pct", "exec", str(MEDIA_CT), "--", "cat", "/opt/media/.qb-password", timeout=15).strip()
    if pw:
        keys["qb"] = pw
    return keys


def arr(app, path, **query):
    port, ver = ARR[app]
    key = media_keys().get(app)
    if not key:
        raise ValueError(f"no API key for {app}")
    url = f"http://{MEDIA_IP}:{port}/api/{ver}/{path}"
    if query:
        url += "?" + urlencode(query)
    return http_json(url, {"X-Api-Key": key}, timeout=25)


def lazylibrarian(cmd, **query):
    key = media_keys().get("lazylibrarian")
    if not key:
        raise ValueError("no API key for lazylibrarian")
    return http_json(f"http://{MEDIA_IP}:{LL_PORT}/api?" + urlencode({"apikey": key, "cmd": cmd, **query}), timeout=25)


_qb_sid = [None, 0.0]


def qb(path, **query):
    """qBittorrent WebUI API — one cookie is reused until it stops working"""
    port, user = QB
    base = f"http://{MEDIA_IP}:{port}/api/v2/"
    for attempt in (0, 1):
        if not _qb_sid[0] or time.time() - _qb_sid[1] > 1800 or attempt:
            body = urlencode({"username": user, "password": media_keys().get("qb", "")}).encode()
            req = urllib.request.Request(base + "auth/login", data=body,
                                         headers={"Referer": f"http://{MEDIA_IP}:{port}"})
            with urllib.request.urlopen(req, timeout=15) as r:
                cookie = r.headers.get("Set-Cookie", "")
            sid = re.search(r"(?:QBT_SID_\d+|SID)=[^;]+", cookie)  # the cookie is named after the WebUI port
            if not sid:
                raise ValueError("qBittorrent login failed")
            _qb_sid[0], _qb_sid[1] = sid[0], time.time()
        try:
            return http_json(base + path + ("?" + urlencode(query) if query else ""),
                             {"Cookie": _qb_sid[0]}, timeout=20)
        except urllib.error.HTTPError as e:
            if e.code != 403 or attempt:
                raise
    return None


@cached(600)
def wan_ip():
    """the household's own public IP — what the VPN must NOT be showing"""
    return sh("curl", "-s", "-m", "8", "https://ipinfo.io/ip", timeout=12).strip() or None


@cached(300)
def vpn_where():
    out = sh("pct", "exec", str(MEDIA_CT), "--", "docker", "exec", "gluetun",
             "wget", "-qO-", "-T", "8", "https://ipinfo.io/json", timeout=25)
    try:
        return json.loads(out)
    except Exception:
        return {}


@cached(20)
def vpn():
    """is the tunnel up, is it actually hiding us, and is the kill switch armed"""
    inspect = js("pct", "exec", str(MEDIA_CT), "--", "docker", "inspect", "gluetun", "--format",
                 "{{json .State}}", timeout=20, default={}) or {}
    rules = sh("pct", "exec", str(MEDIA_CT), "--", "docker", "exec", "gluetun",
               "iptables", "-S", "OUTPUT", timeout=20)
    port = sh("pct", "exec", str(MEDIA_CT), "--", "docker", "exec", "gluetun",
              "cat", "/tmp/gluetun/forwarded_port", timeout=20).strip()
    info, vpn_ip, listen, transfer = vpn_where(), None, None, None
    try:
        transfer = qb("transfer/info")
        vpn_ip = (transfer or {}).get("last_external_address_v4") or None
        listen = (qb("app/preferences") or {}).get("listen_port")
    except Exception:
        pass
    vpn_ip = vpn_ip or info.get("ip")
    home = wan_ip()
    return {
        "up": inspect.get("Running") and (inspect.get("Health") or {}).get("Status") != "unhealthy",
        "health": (inspect.get("Health") or {}).get("Status"),
        "since": inspect.get("StartedAt"),
        "killSwitch": "-P OUTPUT DROP" in rules,
        "ip": vpn_ip,
        "homeIp": home,
        "leaking": bool(vpn_ip and home and vpn_ip == home),
        "country": info.get("country"), "city": info.get("city"), "org": info.get("org"),
        "forwardedPort": int(port) if port.isdigit() else None,
        "listenPort": listen,
        "portOk": bool(port.isdigit() and listen and int(port) == listen),
        "speed": {"down": (transfer or {}).get("dl_info_speed"), "up": (transfer or {}).get("up_info_speed"),
                  "downTotal": (transfer or {}).get("dl_info_data"), "upTotal": (transfer or {}).get("up_info_data"),
                  "status": (transfer or {}).get("connection_status")} if transfer else None,
    }


def queue_items(kind, records, torrents):
    out = []
    for r in records or []:
        t = torrents.get(str(r.get("downloadId", "")).lower(), {})
        size, left = r.get("size") or 0, r.get("sizeleft") or 0
        title = (r.get("movie") or {}).get("title") or (r.get("series") or {}).get("title") \
            or (r.get("album") or {}).get("title") or r.get("title")
        ep = r.get("episode") or {}
        sub = f"S{ep['seasonNumber']:02d}E{ep['episodeNumber']:02d} · {ep.get('title', '')}" if ep.get("episodeNumber") \
            else (r.get("artist") or {}).get("artistName") or r.get("quality", {}).get("quality", {}).get("name")
        out.append({
            "kind": kind, "id": r.get("id"), "title": title, "sub": sub, "release": r.get("title"),
            # a season pack is one torrent behind one queue row per episode
            "hash": str(r.get("downloadId", "")).lower() or None,
            "status": r.get("status"), "state": r.get("trackedDownloadState"), "client": r.get("downloadClient"),
            "size": size, "left": left, "progress": round(100 * (size - left) / size, 1) if size else 0,
            "eta": r.get("timeleft"), "speed": t.get("dlspeed"), "seeds": t.get("num_seeds"),
            # how long since any byte arrived - the difference between slow and dead
            "idleHours": round((time.time() - t["last_activity"]) / 3600, 1)
                         if t.get("last_activity") else None,
            "ratio": round(t.get("ratio", 0), 2) if t.get("ratio") is not None else None,
            "torrentState": t.get("state"),
            "messages": [m.get("messages", [m.get("title")])[0] for m in (r.get("statusMessages") or [])][:3],
            "error": r.get("errorMessage"),
        })
    return out


# a finished torrent stays in qBittorrent to seed; the *arr queues drop an item
# at import, so these have to be filtered out by hand or books never leave the list
SEEDING_STATES = {"uploading", "stalledUP", "queuedUP", "pausedUP", "stoppedUP",
                  "forcedUP", "checkingUP"}


def bare_torrents(torrents, category, kind):
    """downloads with no *arr queue behind them (LazyLibrarian works this way)"""
    return [{
        "kind": kind, "id": h[:8], "hash": h, "title": t.get("name"), "sub": t.get("category"), "release": t.get("name"),
        "status": t.get("state"), "state": None, "client": "qBittorrent",
        "size": t.get("size"), "left": t.get("amount_left"), "progress": round(100 * t.get("progress", 0), 1),
        "eta": None, "speed": t.get("dlspeed"), "seeds": t.get("num_seeds"),
        "ratio": round(t.get("ratio", 0), 2), "torrentState": t.get("state"), "messages": [], "error": None,
    } for h, t in torrents.items()
        if t.get("category") == category and t.get("state") not in SEEDING_STATES]


@cached(300)
def media_sizes():
    """bytes per media directory (ZFS keeps this in ARC, so it is cheap) + what hardlinks save"""
    dirs = [d for d in sorted(MEDIA_ROOT.iterdir()) if d.is_dir()] if MEDIA_ROOT.is_dir() else []
    out = {}
    for d in dirs:
        r = sh("du", "-sb", str(d), timeout=120).split("\t")
        if r and r[0].isdigit():
            out[d.name] = int(r[0])
    used = None
    for line in sh("zfs", "list", "-Hp", "-o", "name,used,avail", "tank/medien").splitlines():
        _, u, avail = line.split("\t")
        used = {"used": int(u), "avail": int(avail)}
    return {"dirs": out, "apparent": sum(out.values()), **(used or {})}


def library():
    def movies():
        m = arr("radarr", "movie") or []
        return {"total": len(m), "have": sum(1 for x in m if x.get("hasFile")),
                "size": sum(x.get("sizeOnDisk") or 0 for x in m),
                "monitored": sum(1 for x in m if x.get("monitored"))}

    def series():
        s = arr("sonarr", "series") or []
        groups = {}
        for x in s:
            key = "anime" if "/anime" in (x.get("rootFolderPath") or "") else "serien"
            st = x.get("statistics") or {}
            g = groups.setdefault(key, {"total": 0, "episodes": 0, "missing": 0, "size": 0})
            g["total"] += 1
            g["episodes"] += st.get("episodeFileCount") or 0
            g["missing"] += max(0, (st.get("episodeCount") or 0) - (st.get("episodeFileCount") or 0))
            g["size"] += st.get("sizeOnDisk") or 0
        return groups

    def books():
        b = lazylibrarian("getAllBooks") or []
        b = b if isinstance(b, list) else []
        return {"total": len(b), "have": sum(1 for x in b if str(x.get("Status", "")).lower() == "open"),
                "wanted": len(lazylibrarian("getWanted") or [])}

    parts = {"movies": POOL.submit(movies), "series": POOL.submit(series),
             "books": POOL.submit(books)}
    out = {}
    for k, f in parts.items():
        try:
            out[k] = f.result(timeout=40)
        except Exception as e:
            out[k] = {"error": str(e)[:200]}
    if isinstance(out.get("series"), dict) and "error" not in out["series"]:
        out["anime"] = out["series"].pop("anime", {"total": 0, "episodes": 0, "missing": 0, "size": 0})
        out["series"] = out["series"].pop("serien", {"total": 0, "episodes": 0, "missing": 0, "size": 0})
    return out


@cached(20)
def watchdog():
    """qb-watchdog.py in CT 106 leaves its last verdict in a file; this is the only
    channel it has, so a missing or stale file is itself worth showing."""
    raw = sh("pct", "exec", str(MEDIA_CT), "--", "cat",
             "/opt/media/qbittorrent/watchdog-report.json", timeout=15)
    try:
        report = json.loads(raw)
    except Exception:
        return None
    report["age"] = max(0, int(time.time()) - int(report.get("ts") or 0))
    return report


@cached(15)
def media():
    torrents, qb_error = {}, None
    try:
        torrents = {t["hash"].lower(): t for t in (qb("torrents/info") or [])}
    except Exception as e:
        # without this the queue still lists every row but with no speeds, and the page claims nothing is moving
        qb_error = str(e)[:200] or type(e).__name__

    def q(app, kind, **extra):
        try:
            r = arr(app, "queue", pageSize=1000, **extra)
            return queue_items(kind, (r or {}).get("records"), torrents)
        except Exception as e:
            return [{"kind": kind, "error": str(e)[:200], "title": f"{app} queue unavailable"}]

    parts = {
        "vpn": POOL.submit(vpn),
        "library": POOL.submit(library),
        "sizes": POOL.submit(media_sizes),
        "watchdog": POOL.submit(watchdog),
        "movies": POOL.submit(q, "radarr", "movies", includeMovie="true"),
        "series": POOL.submit(q, "sonarr", "series", includeSeries="true", includeEpisode="true"),
    }
    res = {}
    for k, f in parts.items():
        try:
            res[k] = f.result(timeout=60)
        except Exception as e:
            res[k] = {"error": str(e)[:200]}
    queues = {"movies": res["movies"], "series": res["series"],
              "books": bare_torrents(torrents, "lazylibrarian", "books")}
    active = [t for t in torrents.values() if t.get("dlspeed") or t.get("state") in ("downloading", "stalledDL", "metaDL")]
    return {"time": int(time.time()), "vpn": res["vpn"], "library": res["library"], "sizes": res["sizes"],
            "queues": queues, "watchdog": res["watchdog"],
            "torrents": {"error": qb_error, "total": len(torrents), "downloading": len(active),
                         "seeding": sum(1 for t in torrents.values() if t.get("state", "").endswith(("UP", "uploading"))),
                         "errored": [t["name"][:80] for t in torrents.values() if "error" in t.get("state", "").lower()][:5]}}


@cached(60)
def media_items():
    """everything the library holds, for the Remove picker — one row per series or film"""
    out = []
    for s in arr("sonarr", "series") or []:
        st = s.get("statistics") or {}
        out.append({"kind": "series", "id": s["id"], "title": s["title"], "year": s.get("year"),
                    "group": "anime" if "/anime" in (s.get("rootFolderPath") or s.get("path") or "") else "series",
                    "path": s.get("path"), "size": st.get("sizeOnDisk") or 0, "files": st.get("episodeFileCount") or 0,
                    "seasons": [{"n": se["seasonNumber"], "monitored": se.get("monitored", False),
                                 "files": (se.get("statistics") or {}).get("episodeFileCount") or 0,
                                 "size": (se.get("statistics") or {}).get("sizeOnDisk") or 0}
                                for se in s.get("seasons") or []]})
    for m in arr("radarr", "movie") or []:
        out.append({"kind": "movie", "id": m["id"], "title": m["title"], "year": m.get("year"), "group": "movie",
                    "path": m.get("path"), "size": m.get("sizeOnDisk") or 0, "files": 1 if m.get("hasFile") else 0})
    return sorted(out, key=lambda x: (x["title"].lower(), x["year"] or 0))


def _seasons(seasons):
    """"1,2" / [1, 2] -> [1, 2]; None or empty -> None (the whole item)"""
    if seasons in (None, "", []):
        return None
    try:
        out = sorted({int(x) for x in (seasons.split(",") if isinstance(seasons, str) else seasons)})
    except (TypeError, ValueError):
        raise ValueError("seasons must be numbers")
    return out or None


def media_plan(kind, item_id, seasons=None):
    """what removing one series/film touches: the *arr entry with its files, and every torrent in qBittorrent
    that its history says it grabbed or imported from. The library files and the seeding copies are hardlinks
    of the same bytes, so the space only comes back once both are gone.

    With seasons (series only) the entry stays: only those seasons' episode files go, the seasons are
    unmonitored so Sonarr does not fetch them again, and the series keeps monitoring new episodes. Only
    torrents whose every episode lies in those seasons are removed — a pack that also covers a kept season
    stays (it would only stop seeding; the kept library files are separate hardlinks either way)."""
    if kind not in ("series", "movie"):
        raise ValueError("kind must be series or movie")
    try:
        item_id = int(item_id)
    except (TypeError, ValueError):
        raise ValueError("id must be a number")
    seasons = _seasons(seasons)
    if seasons and kind != "series":
        raise ValueError("only series have seasons")
    item = next((x for x in media_items() if x["kind"] == kind and x["id"] == item_id), None)
    if not item:
        invalidate("media_items")
        item = next((x for x in media_items() if x["kind"] == kind and x["id"] == item_id), None)
    if not item:
        raise ValueError(f"no {kind} with id {item_id} in {'Sonarr' if kind == 'series' else 'Radarr'}")
    app, hist = ("sonarr", arr("sonarr", "history/series", seriesId=item_id)) if kind == "series" \
        else ("radarr", arr("radarr", "history/movie", movieId=item_id))
    torrents = {t["hash"].lower(): t for t in (qb("torrents/info") or [])}

    def held(hs):
        return [{"hash": h, "name": torrents[h]["name"], "size": torrents[h].get("size") or 0,
                 "state": torrents[h].get("state")} for h in sorted(hs) if h in torrents]

    if not seasons:
        hashes = {str(r["downloadId"]).lower() for r in hist or [] if r.get("downloadId")}
        t = held(hashes)
        return {**item, "app": app, "seasons": None, "torrents": t, "torrentSize": sum(x["size"] for x in t)}

    known = {se["n"]: se for se in item["seasons"]}
    if missing := [n for n in seasons if n not in known]:
        raise ValueError(f"{item['title']} has no season {', '.join(map(str, missing))}")
    ep_season = {e["id"]: e["seasonNumber"] for e in arr("sonarr", "episode", seriesId=item_id) or []}
    by_hash = {}
    for r in hist or []:
        if r.get("downloadId"):
            by_hash.setdefault(str(r["downloadId"]).lower(), set()).add(ep_season.get(r.get("episodeId")))
    only = {h for h, ss in by_hash.items() if ss and ss <= set(seasons)}
    shared = {h for h, ss in by_hash.items() if h not in only and ss & set(seasons)}
    t = held(only)
    return {**item, "app": app, "seasons": seasons,
            "files": sum(known[n]["files"] for n in seasons), "size": sum(known[n]["size"] for n in seasons),
            "latest": max((n for n in known if n > 0), default=None),
            "torrents": t, "torrentSize": sum(x["size"] for x in t), "shared": held(shared)}


def _gb(n):
    return f"{n / 2**30:.1f} GB" if n >= 2**30 else f"{n / 2**20:.0f} MB"


MEDIA_RM = "/root/dashboard/agent/media-rm"


def a_media_remove(args):
    """Destructive and final — unlike project_remove there is no trash. Only the Media page's Remove panel
    offers it (behind two confirmations); it is deliberately not in the Ask bar's action catalog.
    With seasons it removes only those seasons of a series and keeps the series (and its new episodes)."""
    p = media_plan(str(args.get("kind", "")), args.get("id"), args.get("seasons"))
    what = f"{p['title']}" + (f" ({p['year']})" if p.get("year") else "")
    files = f"{p['files']} episode file(s)" if p["kind"] == "series" else ("the film file" if p["files"] else "no file on disk")
    tor = f", and {len(p['torrents'])} torrent(s) in qBittorrent with their data" if p["torrents"] else ""
    hashes = [t["hash"] for t in p["torrents"]]
    if p["seasons"]:
        ss = ", ".join(map(str, p["seasons"]))
        desc = (f"DELETE season {ss} of {what} for good: {files} ({_gb(p['size'])}){tor}. "
                f"Those seasons are unmonitored; the series stays in Sonarr and keeps getting new episodes")
        return desc, ["python3", MEDIA_RM, "season", str(p["id"]), ",".join(map(str, p["seasons"])), *hashes], 600
    desc = (f"DELETE {what} for good: {files} ({_gb(p['size'])}) from {p['path']}{tor}. "
            f"{p['app'].capitalize()} stops tracking it and adds a list exclusion so it is not grabbed again")
    return desc, ["python3", MEDIA_RM, p["kind"], str(p["id"]), *hashes], 600


# --- dev previews ------------------------------------------------------------
def dev_cts():
    return [c for c in cts() if "dev" in c["tags"] and c["type"] == "lxc"]


def pv(vmid, *args, timeout=30):
    r = subprocess.run(["pct", "exec", str(vmid), "--", PV, *args], capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "pv failed")
    return r.stdout


def projects():
    def one(c):
        if c["status"] != "running":
            return {**c, "projects": [], "error": "stopped"}
        try:
            return {**c, "projects": json.loads(pv(c["vmid"], "ls", "--json"))}
        except Exception as e:
            return {**c, "projects": [], "error": str(e)}
    return list(POOL.map(one, dev_cts()))


def checked_project(vmid, path):
    if not any(c["vmid"] == vmid and c["status"] == "running" for c in dev_cts()):
        raise ValueError(f"CT {vmid} is not a running dev box")
    known = [p["path"] for p in json.loads(pv(vmid, "ls", "--json"))]
    if path not in known:
        raise ValueError(f"unknown project {path}")
    return path


def preview(action, vmid, path, ansi=False):
    checked_project(vmid, path)
    if action == "log":
        return json.loads(pv(vmid, "log", path, "300", "--ansi")) if ansi else {"log": pv(vmid, "log", path, "300")}
    return json.loads(pv(vmid, action, path, "--json", timeout=60))


def claude_code(action, vmid, path, profile="noven", ansi=False):
    """start / stop / read a Claude Code session in the project's dev box"""
    checked_project(vmid, path)
    if action == "log":
        if ansi:
            return json.loads(pv(vmid, "cclog", path, "400", "--ansi", timeout=30))
        return {"log": pv(vmid, "cclog", path, "400", timeout=30)}
    if action == "stop":
        return json.loads(pv(vmid, "ccstop", path, "--json", timeout=30))
    if profile not in ("noven", "work"):
        raise ValueError("profile must be noven or work")
    return json.loads(pv(vmid, "cc", path, profile, "--json", timeout=60))


def ship_log(vmid, path, ansi=False):
    """the /conduct conductor's pane (claude-base parallel lanes); read only"""
    checked_project(vmid, path)
    if ansi:
        return json.loads(pv(vmid, "shiplog", path, "400", "--ansi", timeout=30))
    return {"log": pv(vmid, "shiplog", path, "400", timeout=30)}


# --- shells: fresh login shells in a dev box, as max, each in its own tmux session on a private
# socket ("web") so it survives closing the browser, a flaky phone connection and agent restarts.
# That outer tmux is invisible: no status bar, no prefix key, no alternate screen (so the browser keeps
# the scrollback), and $TMUX is unset inside, so `tmux attach -t ship` works from the shell as usual.
SHELL_TMUX = ["tmux", "-L", "web"]
SHELL_RE = re.compile(r"sh-\d{1,4}")
SHELL_SETUP = ["set", "-g", "status", "off", ";", "set", "-g", "prefix", "None", ";", "set", "-g", "prefix2", "None", ";",
               "set", "-g", "escape-time", "0", ";", "set", "-g", "history-limit", "20000", ";",
               "set", "-g", "default-terminal", "tmux-256color", ";", "set", "-g", "window-size", "latest", ";",
               "set", "-ga", "terminal-overrides", ",xterm*:smcup@:rmcup@", ";", "set", "-g", "mouse", "off"]


def dev_box(vmid):
    c = next((c for c in dev_cts() if c["vmid"] == vmid and c["status"] == "running"), None)
    if not c:
        raise ValueError(f"CT {vmid} is not a running dev box")
    return c


def _shell_tmux(vmid, *args, timeout=20):
    # a login environment (HOME, PATH, LANG of max) so the shells it starts look like an ssh login
    # always quote: max's login shell is zsh, where a bare "=sh-1" is expanded as a command path
    cmd = " ".join("'" + a.replace("'", "'\\''") + "'" for a in (*SHELL_TMUX, *args))
    return subprocess.run(["pct", "exec", str(vmid), "--", "runuser", "-l", "max", "-c", cmd],
                          capture_output=True, text=True, timeout=timeout)


def shells():
    def one(c):
        r = _shell_tmux(c["vmid"], "list-sessions", "-F",
                        "#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_current_command}\t#{pane_current_path}")
        out = []
        for line in r.stdout.splitlines() if r.returncode == 0 else []:
            name, created, attached, cmd, cwd = (line.split("\t") + [""] * 5)[:5]
            if SHELL_RE.fullmatch(name):
                out.append({"session": name, "created": int(created or 0), "attached": int(attached or 0),
                            "command": cmd, "cwd": cwd.replace("/home/max", "~", 1)})
        out.sort(key=lambda x: int(x["session"][3:]))
        return {"vmid": c["vmid"], "name": c["name"], "shells": out}
    return list(POOL.map(one, [c for c in dev_cts() if c["status"] == "running"]))


def shell_new(vmid):
    dev_box(vmid)
    taken = {int(s["session"][3:]) for s in next((b["shells"] for b in shells() if b["vmid"] == vmid), [])}
    name = f"sh-{next(i for i in range(1, 10000) if i not in taken)}"
    r = _shell_tmux(vmid, "-f", "/dev/null", "new-session", "-d", "-s", name, "-x", "120", "-y", "40", "-c", "/home/max",
                    "exec env -u TMUX -u TMUX_PANE zsh -l", ";", *SHELL_SETUP)
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip() or "could not start a shell")
    return {"vmid": vmid, "session": name}


def shell_kill(vmid, session):
    dev_box(vmid)
    if not SHELL_RE.fullmatch(session):
        raise ValueError("not a shell session")
    _shell_tmux(vmid, "kill-session", "-t", "=" + session)
    return {"killed": session}


# --- full-screen terminal: a real `tmux attach` on a pty, streamed to the browser ---------
# Only ever attaches to a project's own preview / Claude session (names come from `pv ls`), as max.
# Closing detaches the client; the tmux session keeps running.
TERMS = {}
TERMS_LOCK = threading.Lock()
TERM_BUF = 1 << 20          # keep at most 1 MiB of output for reconnects
TERM_IDLE = 90              # seconds without a stream reader before the client is detached
DEFAULT_SIZE = {"preview": (140, 45), "cc": (140, 45), "ship": None, "shell": None}  # what pv creates; restored on close


def _winsize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _dims(cols, rows):
    cols, rows = int(cols), int(rows)
    if not (20 <= cols <= 500 and 5 <= rows <= 200):
        raise ValueError("bad terminal size")
    return cols, rows


class Term:
    def __init__(self, vmid, session, target, cols, rows):
        self.vmid, self.session, self.target = vmid, session, target
        self.buf, self.base = bytearray(), 0   # base = stream offset of buf[0]
        self.cond = threading.Condition()
        self.alive, self.readers, self.seen = True, 0, time.time()
        tmux = SHELL_TMUX if target == "shell" else ["tmux"]
        attach = [*tmux, "attach", "-t", "=" + session]
        self.view = None
        if target == "ship":
            # The ship session is usually also open on the desktop (kitty, 4 lanes side by side). A plain attach
            # from a phone shrank every lane to phone width and shared one current window, so switching windows
            # in the browser flipped the desktop too. Instead: a throwaway session grouped with it (same windows,
            # its own current window), destroyed as soon as this view detaches. Sizes follow window-size latest:
            # the window fits whichever screen typed last. (ignore-size was tried: a forgotten kitty client then
            # pinned 315x73 and the browser only saw a cut-out of it — empty right edge, clipped input line.)
            self.view = f"{session}-web-{secrets.token_hex(3)}"
            cur = subprocess.run(["pct", "exec", str(vmid), "--", "runuser", "-u", "max", "--", "tmux", "display",
                                  "-p", "-t", f"={session}:", "#{window_index}"], capture_output=True, text=True, timeout=15)
            attach = ["tmux", "new-session", "-t", "=" + session, "-s", self.view, ";",
                      "set", "destroy-unattached", "on"]
            if cur.stdout.strip().isdigit():
                attach += [";", "select-window", "-t", ":" + cur.stdout.strip()]
        pid, fd = pty.fork()
        if pid == 0:
            tty.setraw(0)
            os.execvp("pct", ["pct", "exec", str(vmid), "--", "env", "TERM=xterm-256color", "LANG=C.UTF-8",
                              "runuser", "-u", "max", "--", *attach])
        self.pid, self.fd = pid, fd
        _winsize(fd, cols, rows)
        threading.Thread(target=self._rawout, daemon=True).start()
        threading.Thread(target=self._pump, daemon=True).start()

    def _rawout(self, until=None):
        """lxc-attach (pct exec) switches our side of the pty back to OPOST|ONLCR on start, so tmux's cursor-down
        "\n" arrived as "\r\n": a right-hand pane's next row was painted from column 0, over the left pane (the
        ship lanes smearing each other). Undo that as soon as it appears; _pump re-checks before every read."""
        until = until or time.time() + 5
        while self.alive:
            try:
                a = termios.tcgetattr(self.fd)
                if a[1] & (termios.OPOST | termios.ONLCR):
                    a[1] &= ~(termios.OPOST | termios.ONLCR)
                    termios.tcsetattr(self.fd, termios.TCSANOW, a)
            except (termios.error, OSError):
                return
            if time.time() > until:
                return
            time.sleep(0.02)

    def _pump(self):
        while True:
            try:
                self._rawout(until=1)  # one check
                data = os.read(self.fd, 65536)
            except OSError:
                data = b""
            with self.cond:
                if not data:
                    self.alive = False
                    self.cond.notify_all()
                    return
                self.buf += data
                if len(self.buf) > TERM_BUF:
                    cut = len(self.buf) - TERM_BUF
                    del self.buf[:cut]
                    self.base += cut
                self.cond.notify_all()

    def write(self, data: bytes):
        os.write(self.fd, data)

    def close(self):
        try:
            os.kill(self.pid, signal.SIGTERM)
            os.waitpid(self.pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass
        if self.view:  # destroy-unattached normally already took it
            subprocess.run(["pct", "exec", str(self.vmid), "--", "runuser", "-u", "max", "--", "tmux",
                            "kill-session", "-t", "=" + self.view], capture_output=True, timeout=15)
        # hand the window back its usual size, and let the next attach resize it again
        size = DEFAULT_SIZE[self.target]
        if not size:  # the ship session follows whoever attached last anyway
            return
        w, h = size
        subprocess.run(["pct", "exec", str(self.vmid), "--", "runuser", "-u", "max", "--", "tmux",
                        "resize-window", "-t", self.session, "-x", str(w), "-y", str(h), ";",
                        "set-window-option", "-t", self.session, "window-size", "latest"],
                       capture_output=True, timeout=15)


def term_open(vmid, path, target, cols, rows, session=None):
    cols, rows = _dims(cols, rows)
    if target == "shell":
        dev_box(vmid)
        if not SHELL_RE.fullmatch(str(session)) or _shell_tmux(vmid, "has-session", "-t", f"={session}").returncode:
            raise ValueError(f"no shell {session} in CT {vmid}")
        tid = secrets.token_urlsafe(18)
        with TERMS_LOCK:
            TERMS[tid] = Term(vmid, session, target, cols, rows)
        return {"id": tid, "session": session}
    checked_project(vmid, path)
    if target not in ("preview", "cc", "ship"):
        raise ValueError("target must be preview, cc, ship or shell")
    p = next(p for p in json.loads(pv(vmid, "ls", "--json")) if p["path"] == path)
    if target == "ship":
        session, alive = (p.get("ship") or {}).get("session"), (p.get("ship") or {}).get("running")
    elif target == "cc":
        session, alive = p["cc"]["session"], p["cc"]["running"]
    else:
        session, alive = p["session"], p["running"] or p.get("exited") is not None
    if not alive:
        raise ValueError(f"{session} is not running")
    tid = secrets.token_urlsafe(18)
    with TERMS_LOCK:
        TERMS[tid] = Term(vmid, session, target, cols, rows)
    return {"id": tid, "session": session}


def term_get(tid):
    t = TERMS.get(str(tid))
    if not t:
        raise ValueError("terminal is closed")
    return t


def term_close(tid):
    with TERMS_LOCK:
        t = TERMS.pop(str(tid), None)
    if t:
        t.close()
    return {"closed": bool(t)}


def term_reaper():
    while True:
        time.sleep(15)
        now = time.time()
        for tid, t in list(TERMS.items()):
            if (not t.alive) or (t.readers == 0 and now - t.seen > TERM_IDLE):
                threading.Thread(target=term_close, args=(tid,), daemon=True).start()


def _gh_user():
    """the GitHub account this server belongs to — override by writing a name into keys/github_user"""
    if GH_USER_FILE.exists():
        name = GH_USER_FILE.read_text().strip()
        if re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})", name):
            return name
    return GH_USER


def _gh_repo(r):
    return {"name": r["name"], "full": r["full_name"], "owner": r["owner"]["login"], "ssh": r["ssh_url"],
            "url": r["html_url"], "private": r["private"], "fork": r.get("fork", False),
            "archived": r.get("archived", False), "lang": r.get("language"), "stars": r.get("stargazers_count", 0),
            "branch": r.get("default_branch"), "pushed": r.get("pushed_at"),
            "desc": (r.get("description") or "")[:140]}


@cached(120)
def github_repos():
    """the owner's repos, for the project picker. With a token in keys/github_token this is every repo
    (private included); without one we still list the public repos of keys/github_user (GH_USER)."""
    user = _gh_user()
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "pve-dashboard"}
    token = GH_TOKEN_FILE.read_text().strip() if GH_TOKEN_FILE.exists() else ""
    if token:
        url = "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator"
        headers["Authorization"] = f"Bearer {token}"
    else:
        url = f"https://api.github.com/users/{user}/repos?per_page=100&sort=pushed"
    out = {"configured": bool(token), "user": user, "url": f"https://github.com/{user}?tab=repositories",
           "scope": "all repos incl. private" if token else "public repos only",
           "repos": []}
    if not token:
        out["hint"] = ("listing public repos of " + user + " — put a GitHub token (repo scope) in "
                       "/root/devbox/keys/github_token to see private ones too")
    try:
        data = http_json(url, headers, timeout=25) or []
        out["repos"] = [_gh_repo(r) for r in data]
    except Exception as e:
        out["error"] = str(e)[:200]
    return out


# --- actions -----------------------------------------------------------------
# Every action the dashboard (and through it the AI) may run. Arguments are validated here, argv is fixed:
# nothing the caller sends is ever passed to a shell. Nothing destructive lives in this table — no destroy,
# no rm, no dataset/volume deletion.
SERVICES = {
    "dash": (104, "systemd", "dash"),
    "ollama": (105, "systemd", "ollama"),
    "open-webui": (105, "systemd", "open-webui"),
    "searxng": (105, "docker", "searxng"),
    "immich": (101, "docker", "immich_server"),
    "immich-ml": (101, "docker", "immich_machine_learning"),
    "jellyfin": (102, "docker", "jellyfin"),
    "audiobookshelf": (103, "docker", "audiobookshelf"),
    # download stack (CT 106). Restarting gluetun drops the network namespace
    # that qbittorrent, prowlarr and flaresolverr share; media-vpn-sync.service
    # on CT 106 re-attaches them automatically, so restarting it here is safe.
    "seerr": (106, "docker", "seerr"),
    "qbittorrent": (106, "docker", "qbittorrent"),
    "prowlarr": (106, "docker", "prowlarr"),
    "radarr": (106, "docker", "radarr"),
    "sonarr": (106, "docker", "sonarr"),
    "bazarr": (106, "docker", "bazarr"),
    "lazylibrarian": (106, "docker", "lazylibrarian"),
    "gluetun": (106, "docker", "gluetun"),
    "subgen": (105, "docker", "subgen"),
}
AI_CT = 105


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

    futures = [POOL.submit(one, v, items) for v, items in by_ct.items()]
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


def backup_busy():
    """reasons a vzdump should not start right now. Snapshot mode does not stop or freeze anything, but only one
    vzdump runs at a time, it takes a lock on each guest, and it competes with an upgrade for disk I/O."""
    out = []
    tasks = js("pvesh", "get", "/nodes/pve/tasks", "--source", "active", "--output-format", "json", default=[]) or []
    for t in tasks:
        if t.get("type") in ("vzdump", "vzrestore", "vzsnapshot", "vzrollback", "vzmigrate"):
            out.append(f"a {t['type']} task is already running ({t.get('id') or 'all guests'}, started by {t.get('user')})")
    if not any("vzdump" in r for r in out) and subprocess.run(["pgrep", "-x", "vzdump"], capture_output=True).returncode == 0:
        out.append("a vzdump process is already running")
    for conf in sorted(Path("/etc/pve/lxc").glob("*.conf")):
        m = re.search(r"^lock:\s*(\S+)", conf.read_text().split("\n[", 1)[0], re.M)
        if m:
            out.append(f"CT {conf.stem} is locked ({m[1]})")
    with JOBS_LOCK:
        for j in JOBS.values():
            if j["done"] is None and j["action"] in ("backup_ct", "backup_all", "apt_upgrade", "apt_upgrade_all"):
                out.append(f"dashboard job still running: {j['desc']}")
    return out


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
    busy = backup_busy()
    if busy:
        raise ValueError("not now — " + "; ".join(busy))
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
    if not 200 <= vmid <= 299:
        raise ValueError("dev boxes use ids 200-299")
    if any(c["vmid"] == vmid for c in cts()):
        raise ValueError(f"CT {vmid} already exists")
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,20}", name):
        raise ValueError("name must be lowercase letters, digits and dashes")
    m = re.fullmatch(r"192\.168\.178\.(\d{1,3})", ip)
    if not m or not 60 <= int(m[1]) <= 99:
        raise ValueError("ip must be 192.168.1.60-99")
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

JOBS, JOBS_LOCK = {}, threading.Lock()
MAX_LOG = 400


def check_action(name, args):
    """validate without running — returns the human-readable description"""
    fn = ACTIONS.get(name)
    if not fn:
        raise ValueError(f"unknown action {name}")
    return fn(dict(args or {}))[0]


def _run_job(job, argv, timeout):
    try:
        p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        job["pid"] = p.pid
        for line in p.stdout:
            with JOBS_LOCK:
                job["log"].append(line.rstrip()[:500])
                del job["log"][:-MAX_LOG]
        job["rc"] = p.wait(timeout=timeout)
    except Exception as e:
        job["log"].append(f"agent: {e}")
        job["rc"] = -1
    finally:
        job["done"] = int(time.time())
        invalidate("updates", "ct_ports", "overview", "media_items", "media", "media_sizes", "service_uptime")


def start_action(name, args):
    desc, argv, timeout = ACTIONS[name](dict(args or {})) if name in ACTIONS else (_ for _ in ()).throw(ValueError(f"unknown action {name}"))
    job = {"id": f"{int(time.time())}-{len(JOBS) + 1}", "action": name, "args": args, "desc": desc,
           "argv": argv, "started": int(time.time()), "done": None, "rc": None, "log": []}
    with JOBS_LOCK:
        JOBS[job["id"]] = job
        for old in sorted(JOBS.values(), key=lambda j: j["started"])[:-40]:
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


# --- Claude chat: `claude -p` on the host, one transient systemd unit per turn ------------------
# The unit writes stream-json to a file and the browser tails that file, so a turn keeps running through a
# dropped phone connection, a page reload and the agent restart that deploy.sh does. Read-only by default
# (dontAsk: only read-only commands + RO_ALLOW, everything else is denied without asking); `auto` hands the
# turn to Claude Code's auto mode, where the classifier (and settings.json autoMode rules) still gate each step.
# Reachable only behind the dashboard PIN (web/server/middleware/auth.ts).
CLAUDE = "/root/.local/bin/claude"
CC_DIR = Path("/var/lib/dash-claude")
CC_KEEP_DAYS = 30
RO_ALLOW = [
    "Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite", "Task", "Agent",
    "Bash(pct list)", "Bash(pct config *)", "Bash(pct status *)", "Bash(pct df *)", "Bash(qm list)",
    "Bash(pvesh get *)", "Bash(pvesm status *)", "Bash(pvesm status)", "Bash(pveversion *)", "Bash(pveversion)",
    "Bash(zfs list *)", "Bash(zfs list)", "Bash(zfs get *)", "Bash(zpool status *)", "Bash(zpool status)",
    "Bash(zpool list *)", "Bash(zpool list)", "Bash(systemctl status *)", "Bash(systemctl list-units *)",
    "Bash(systemctl list-timers *)", "Bash(systemctl is-active *)", "Bash(journalctl *)", "Bash(df *)", "Bash(free *)",
    "Bash(sensors *)", "Bash(sensors)", "Bash(nvidia-smi *)", "Bash(nvidia-smi)", "Bash(tailscale status *)",
    "Bash(tailscale status)", "Bash(ip a *)", "Bash(ip a)", "Bash(ss -tlnp *)", "Bash(ss -tlnp)", "Bash(uptime)",
    "Bash(git log *)", "Bash(git status *)", "Bash(git diff *)", "Bash(git show *)",
    "Bash(pct exec * -- cat *)", "Bash(pct exec * -- ls *)", "Bash(pct exec * -- tail *)", "Bash(pct exec * -- df *)",
    "Bash(pct exec * -- journalctl *)", "Bash(pct exec * -- systemctl status *)", "Bash(pct exec * -- docker ps *)",
    "Bash(pct exec 104 -- curl -s http://127.0.0.1:3000/api/*)",
]
CC_SYSTEM = """You are answering in the Chat tab of the owner's homelab dashboard (https://dash.example-tailnet.ts.net), as root on the Proxmox host pve, cwd /root. The owner is often on a phone: keep answers short, use markdown, and avoid wide tables and long code dumps unless they are asked for.
Dashboard source: /root/dashboard (agent/agent.py runs on pve, web/ is Nuxt in CT 104). Deploy with ./deploy.sh. It restarts the agent and the app, and this conversation survives that because it runs in its own systemd unit. Another Claude session may be editing the dashboard at the same time, so check `git status` and file mtimes before touching a file, and never revert work you didn't do.
The Notes tab's notes are JSON at `pct exec 104 -- curl -s http://127.0.0.1:3000/api/notes`. When the owner says "build my note about X", read it there first.
QUESTIONS: you have no AskUserQuestion tool here. When the owner should decide something (which approach, which option, missing details), end your answer with ONE fenced block and stop, without guessing ahead:
```questions
[{"header": "Storage", "q": "Where should the notes database live?", "multi": false,
  "options": [{"label": "CT 104 (Recommended)", "description": "rides along in the nightly backup"}, {"label": "tank", "description": "…"}]}]
```
1-4 questions, 2-4 options each, a header of at most 12 characters, the recommended option first and marked "(Recommended)". "multi": true lets several be picked. The dashboard renders this as tap-to-answer buttons with a free-text "Other", and the answers arrive as the next message. Keep the prose above the block short.
"""
CC_RO = """MODE: READ-ONLY. You can read files and run read-only commands, and anything that would change state is denied automatically. Don't work around a denial. When a fix needs a change, say exactly what you would change and tell the owner to switch on **Auto** in the chat header and ask again."""
CC_AUTO = """MODE: AUTO. The owner switched on write access for this message. You may edit files, run commands, deploy and restart services. Nobody approves individual steps, so prefer reversible changes, don't delete data, and keep the scope to what was asked. Finish with a short list of what you changed and how to undo it."""
CC_MODELS = ("fable", "opus", "sonnet", "haiku")
CC_EFFORTS = ("low", "medium", "high", "xhigh", "max")
CC_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _cc_unit(chat):
    if not re.fullmatch(r"[a-z0-9]{4,16}", chat or ""):
        raise ValueError("bad chat id")
    return f"dash-claude-{chat}"


def _cc_pid(unit):
    try:
        return int(sh("systemctl", "show", "-p", "MainPID", "--value", unit).strip() or 0)
    except ValueError:
        return 0


def _cc_cleanup():
    cutoff = time.time() - CC_KEEP_DAYS * 86400
    for f in CC_DIR.glob("*"):
        try:
            if f.stat().st_mtime < cutoff:
                shutil.rmtree(f) if f.is_dir() else f.unlink()
        except OSError:
            pass


def claude_send(chat, session, prompt, auto, model=None, effort=None, images=None):
    unit = _cc_unit(chat)
    if not CC_UUID.fullmatch(session or ""):
        raise ValueError("bad session id")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 200_000:
        raise ValueError("empty or too long message")
    if model not in (None, *CC_MODELS) or effort not in (None, *CC_EFFORTS):
        raise ValueError("unknown model or effort")
    if _cc_pid(unit):
        raise ValueError("Claude is still answering in this chat — stop it first")
    CC_DIR.mkdir(mode=0o700, exist_ok=True)
    _cc_cleanup()
    turn = f"{chat}-{int(time.time() * 1000)}"
    # a session Claude Code already stored is resumed, an unknown id starts one under that id
    known = any(Path("/root/.claude/projects").glob(f"*/{session}.jsonl"))
    # screenshots / files dropped into the chat: saved next to the turn, Claude opens them with Read (it sees images and PDFs)
    paths, shots = [], 0
    for i, im in enumerate((images or [])[:8]):
        name = str(im.get("name", ""))
        if re.fullmatch(r"[a-f0-9]{24}\.(jpg|png|webp)", name):
            f, shots = CC_DIR / f"{turn}-{i}.{name.rsplit('.', 1)[-1]}", shots + 1
        elif m := re.fullmatch(r"[a-f0-9]{24}-([\w.-]{1,100})", name):
            d = CC_DIR / f"{turn}-{i}"  # own folder so the file keeps its real name
            d.mkdir(mode=0o700, exist_ok=True)
            f = d / m[1].lstrip(".")
        else:
            continue
        f.write_bytes(base64.b64decode(im.get("data", "")))
        paths.append(str(f))
    if paths:
        what = "a screenshot" if shots == len(paths) == 1 else f"{len(paths)} screenshots" if shots == len(paths) else \
               "a file" if len(paths) == 1 else f"{len(paths)} files"
        prompt += f"\n\n[The owner attached {what}. Look at " + ("it" if len(paths) == 1 else "them") + \
                  " first (Read handles images, PDFs and text; use Bash for archives or binaries): " + ", ".join(paths) + "]"
    cmd = [CLAUDE, "-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
           "--resume" if known else "--session-id", session, "--permission-prompts", "none",
           "--append-system-prompt", CC_SYSTEM + (CC_AUTO if auto else CC_RO),
           "--disallowedTools", "AskUserQuestion"]
    cmd += ["--model", model] if model else []
    cmd += ["--effort", effort] if effort else []
    if auto:
        cmd += ["--permission-mode", "auto"]
    else:
        cmd += ["--permission-mode", "dontAsk", "--allowedTools", *RO_ALLOW,
                "--disallowedTools", "Write", "Edit", "NotebookEdit"]
    out = CC_DIR / f"{turn}.jsonl"
    r = subprocess.run(["systemd-run", "--unit", unit, "--collect", "--quiet",
                        "-p", "WorkingDirectory=/root", "-p", "StandardInput=null",
                        "-p", f"StandardOutput=file:{out}", "-p", f"StandardError=file:{CC_DIR / f'{turn}.err'}",
                        "-p", "RuntimeMaxSec=3h",
                        "-E", "HOME=/root", "-E", "CLAUDE_PROFILE=noven", "-E", "TERM=dumb",
                        "-E", "PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                        *cmd], capture_output=True, text=True, timeout=20)
    if r.returncode:
        raise ValueError(f"could not start claude: {r.stderr.strip()[:300]}")
    pid = _cc_pid(unit)
    (CC_DIR / f"{turn}.json").write_text(json.dumps({"chat": chat, "session": session, "auto": bool(auto),
                                                      "pid": pid, "t0": _starttime(pid), "started": time.time()}))
    return {"turn": turn, "resumed": known}


def _cc_last_limits(path):
    """the newest rate_limit_event in a stream-json file (one per API call, carries the subscription windows)"""
    info = None
    try:
        with open(path, "rb") as f:
            for line in f:
                if b'"rate_limit_event"' in line:
                    info = json.loads(line).get("rate_limit_info") or info
    except (OSError, ValueError):
        pass
    return info


def claude_usage(refresh=False):
    """5-hour + weekly subscription use as Claude Code last saw it: from the newest chat turn, or — on refresh — from
    a one-word Haiku call (≈3 s, a negligible slice of the window). Covers the whole account, terminal sessions too."""
    snap = CC_DIR / "usage.json"
    if refresh:
        r = subprocess.run([CLAUDE, "-p", "ok", "--model", "haiku", "--effort", "low", "--no-session-persistence",
                            "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk", "--tools", ""],
                           capture_output=True, text=True, timeout=60, cwd="/tmp",
                           env={**os.environ, "HOME": "/root", "CLAUDE_PROFILE": "noven"})
        info = next((json.loads(l)["rate_limit_info"] for l in r.stdout.splitlines() if '"rate_limit_event"' in l), None)
        if not info:
            raise ValueError(f"no usage in claude's answer: {(r.stderr or r.stdout).strip()[-200:]}")
        CC_DIR.mkdir(mode=0o700, exist_ok=True)
        snap.write_text(json.dumps({"info": info, "at": time.time()}))
    best = json.loads(snap.read_text()) if snap.exists() else None
    for f in sorted(CC_DIR.glob("*.jsonl"), key=lambda f: f.stat().st_mtime, reverse=True)[:10]:
        if best and f.stat().st_mtime <= best["at"]:
            break
        info = _cc_last_limits(f)
        if info:
            best = {"info": info, "at": f.stat().st_mtime}
            break
    if not best:
        return {"at": None, "windows": {}}
    i = best["info"]
    return {"at": int(best["at"]), "status": i.get("status"), "limited": i.get("rateLimitType") if i.get("status") == "rejected" else None,
            "windows": {k: {"used": v.get("utilization"), "resets": v.get("resetsAt")} for k, v in (i.get("unifiedWindows") or {}).items()}}


def claude_stop(chat):
    sh("systemctl", "stop", _cc_unit(chat))
    return {"ok": True}


def _cc_turn(turn):
    if not re.fullmatch(r"[a-z0-9]{4,16}-\d{13}", turn or ""):
        raise ValueError("bad turn id")
    meta = CC_DIR / f"{turn}.json"
    if not meta.exists():
        raise ValueError("unknown turn")
    return json.loads(meta.read_text()), CC_DIR / f"{turn}.jsonl", CC_DIR / f"{turn}.err"


def _starttime(pid):
    """field 22 of /proc/<pid>/stat: identifies this process even after its pid is reused"""
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19] if pid > 0 else None
    except (OSError, IndexError):
        return None


def _alive(meta):
    return meta.get("pid", 0) > 0 and _starttime(meta["pid"]) == meta.get("t0")


# --- http -------------------------------------------------------------------
@cached(3)
def overview():
    c = cts()
    parts = {"host": POOL.submit(host), "gpu": POOL.submit(gpu), "pools": POOL.submit(pools),
             "datasets": POOL.submit(datasets), "backups": POOL.submit(backups, c), "tailnet": POOL.submit(tailnet),
             "ports": POOL.submit(ports, c), "smart": POOL.submit(smart), "updates": POOL.submit(all_updates, c),
             "uptime": POOL.submit(service_uptime)}
    return {"time": int(time.time()), "cts": c, **{k: f.result() for k, f in parts.items()}}


class H(BaseHTTPRequestHandler):
    def _auth(self):
        if self.client_address[0] not in ALLOW or self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self._send(403, {"error": "forbidden"})
            return False
        return True

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._auth():
            return
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/overview":
                return self._send(200, overview())
            if u.path == "/projects":
                return self._send(200, projects())
            if u.path == "/media":
                return self._send(200, media())
            if u.path == "/github/repos":
                return self._send(200, github_repos())
            if u.path == "/media/items":
                return self._send(200, media_items())
            if u.path == "/media/plan":
                return self._send(200, media_plan(q.get("kind"), q.get("id"), q.get("seasons")))
            ansi = q.get("ansi") == "1"
            if u.path == "/cc/log":
                return self._send(200, claude_code("log", int(q["vmid"]), q["path"], ansi=ansi))
            if u.path == "/ship/log":
                return self._send(200, ship_log(int(q["vmid"]), q["path"], ansi))
            if u.path == "/preview/log":
                return self._send(200, preview("log", int(q["vmid"]), q["path"], ansi))
            if u.path == "/shells":
                return self._send(200, shells())
            if u.path == "/action/status":
                return self._send(200, job_status(q["id"]))
            if u.path == "/claude/usage":
                return self._send(200, claude_usage())
            if u.path == "/claude/stream":
                return self._claude_stream(q["turn"], int(q.get("from", 0)))
            if u.path == "/term/stream":
                return self._term_stream(term_get(q["id"]), int(q.get("from", 0)))
            self._send(404, {"error": "not found"})
        except (ValueError, KeyError) as e:
            self._send(400, {"error": str(e)})

    def do_POST(self):
        if not self._auth():
            return
        u = urlparse(self.path)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or "{}")
            m = re.fullmatch(r"/preview/(start|stop)", u.path)
            if m:
                return self._send(200, preview(m[1], int(body["vmid"]), str(body["path"])))
            m = re.fullmatch(r"/cc/(start|stop)", u.path)
            if m:
                return self._send(200, claude_code(m[1], int(body["vmid"]), str(body["path"]),
                                                   str(body.get("profile", "noven"))))
            if u.path == "/term/open":
                return self._send(200, term_open(int(body["vmid"]), str(body.get("path", "")), str(body["target"]),
                                                 body.get("cols", 80), body.get("rows", 24), body.get("session")))
            if u.path == "/shells/new":
                return self._send(200, shell_new(int(body["vmid"])))
            if u.path == "/shells/kill":
                return self._send(200, shell_kill(int(body["vmid"]), str(body["session"])))
            if u.path == "/term/input":
                data = body.get("data", "")
                if not isinstance(data, str) or len(data) > 65536:
                    raise ValueError("bad input")
                term_get(body["id"]).write(data.encode())
                return self._send(200, {"ok": True})
            if u.path == "/term/resize":
                t = term_get(body["id"])
                _winsize(t.fd, *_dims(body["cols"], body["rows"]))
                return self._send(200, {"ok": True})
            if u.path == "/term/close":
                return self._send(200, term_close(body["id"]))
            if u.path == "/claude/send":
                return self._send(200, claude_send(str(body.get("chat")), str(body.get("session")), body.get("prompt"),
                                                   body.get("auto") is True, body.get("model"), body.get("effort"),
                                                   [i for i in body.get("images") or [] if isinstance(i, dict)]))
            if u.path == "/claude/usage":
                return self._send(200, claude_usage(refresh=True))
            if u.path == "/claude/stop":
                return self._send(200, claude_stop(str(body.get("chat"))))
            if u.path == "/action/check":
                return self._send(200, {"desc": check_action(str(body.get("name")), body.get("args"))})
            if u.path == "/action/run":
                return self._send(200, start_action(str(body.get("name")), body.get("args")))
            self._send(404, {"error": "not found"})
        except (ValueError, KeyError) as e:
            self._send(400, {"error": str(e)})

    def _term_stream(self, t, pos):
        """server-sent events: `data:` = base64 of the pty output from byte offset `pos`, `event: end` when it exits"""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        t.readers += 1
        try:
            while True:
                with t.cond:
                    if pos - t.base >= len(t.buf) and t.alive:
                        t.cond.wait(15)
                    start = max(pos - t.base, 0)
                    chunk = bytes(t.buf[start:])
                    pos = t.base + len(t.buf)
                    alive = t.alive
                    t.seen = time.time()
                if chunk:
                    self.wfile.write(f"id: {pos}\ndata: {base64.b64encode(chunk).decode()}\n\n".encode())
                elif alive:
                    self.wfile.write(b": ping\n\n")
                if not alive:
                    self.wfile.write(b"event: end\ndata: \n\n")
                    self.wfile.flush()
                    return
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            t.readers -= 1
            t.seen = time.time()

    def _claude_stream(self, turn, skip):
        """server-sent events: one `data:` per stream-json line from line `skip` on, then `event: end` once the
        turn's process is gone and the file is drained (data = stderr tail, which says why a turn died early)"""
        meta, out, err = _cc_turn(turn)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        n, last = 0, time.time()
        try:
            with open(out, "rb") as f:
                part = b""
                while True:
                    alive = _alive(meta)
                    chunk = f.read()
                    if chunk:
                        part += chunk
                        *lines, part = part.split(b"\n")
                        for line in lines:
                            if line.strip() and (n := n + 1) > skip:
                                self.wfile.write(b"data: " + line + b"\n\n")
                        self.wfile.flush()
                        last = time.time()
                    elif not alive:
                        tail = err.read_text(errors="replace")[-1500:] if err.exists() else ""
                        self.wfile.write(f"event: end\ndata: {json.dumps({'err': tail})}\n\n".encode())
                        self.wfile.flush()
                        return
                    elif time.time() - last > 15:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        last = time.time()
                    else:
                        time.sleep(0.15)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, fmt, *args):
        if not self.path.startswith(("/overview", "/projects", "/media", "/preview/log", "/cc/log", "/ship/log", "/shells",
                                     "/action/status", "/term/", "/claude/stream", "/claude/usage", "/github/repos", "/media/items", "/media/plan")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    cpu_percent()
    threading.Thread(target=term_reaper, daemon=True).start()
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
