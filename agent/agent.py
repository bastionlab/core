#!/usr/bin/env python3
"""pve dashboard agent — read-only host data plus a fixed set of dev-preview actions.

Serves JSON to the dashboard CT only (source IP + bearer token). It never runs caller-supplied
commands: previews go through `pv` inside a CT tagged `dev`, for a project path that `pv ls` listed.
"""
import json, os, re, shlex, subprocess, threading, time, urllib.error, urllib.request
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
    }


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
        out.append({"name": name, "size": int(size), "alloc": int(alloc), "free": int(free), "health": health,
                    "frag": int(frag.rstrip("%") or 0), "scan": scan[1].strip() if scan else None,
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
    return {
        "vzdump": [{"vmid": c["vmid"], "name": c["name"], **per.get(c["vmid"], {"time": None, "size": None, "count": 0})}
                   for c in cts],
        "vzdumpJobs": [{"schedule": j.get("schedule"), "enabled": j.get("enabled", 1), "storage": j.get("storage"),
                        "all": j.get("all")} for j in jobs],
        "sanoid": {**unit("sanoid.service"),
                   "datasets": [{"name": k, **v} for k, v in sorted(snaps.items()) if k.startswith("tank")]},
        "syncoid": {**unit("syncoid.service"),
                    "datasets": [{"name": k, **v} for k, v in sorted(snaps.items()) if k.startswith("backup/")]},
    }


@cached(3600)
def smart():
    out = []
    for dev in sorted(Path("/dev").glob("sd?")) + sorted(Path("/dev").glob("nvme?n1")):
        d = js("smartctl", "-j", "-a", str(dev), default={}) or {}
        out.append({"dev": dev.name, "model": d.get("model_name"), "passed": d.get("smart_status", {}).get("passed"),
                    "temp": d.get("temperature", {}).get("current"), "hours": d.get("power_on_time", {}).get("hours"),
                    "size": d.get("user_capacity", {}).get("bytes")})
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
ARR = {"radarr": (7878, "v3"), "sonarr": (8989, "v3"), "lidarr": (8686, "v1"), "prowlarr": (9696, "v1")}
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
    for app in ("radarr", "sonarr", "lidarr", "prowlarr"):
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
            "status": r.get("status"), "state": r.get("trackedDownloadState"), "client": r.get("downloadClient"),
            "size": size, "left": left, "progress": round(100 * (size - left) / size, 1) if size else 0,
            "eta": r.get("timeleft"), "speed": t.get("dlspeed"), "seeds": t.get("num_seeds"),
            "ratio": round(t.get("ratio", 0), 2) if t.get("ratio") is not None else None,
            "torrentState": t.get("state"),
            "messages": [m.get("messages", [m.get("title")])[0] for m in (r.get("statusMessages") or [])][:3],
            "error": r.get("errorMessage"),
        })
    return out


def bare_torrents(torrents, category, kind):
    """downloads with no *arr queue behind them (LazyLibrarian works this way)"""
    return [{
        "kind": kind, "id": h[:8], "title": t.get("name"), "sub": t.get("category"), "release": t.get("name"),
        "status": t.get("state"), "state": None, "client": "qBittorrent",
        "size": t.get("size"), "left": t.get("amount_left"), "progress": round(100 * t.get("progress", 0), 1),
        "eta": None, "speed": t.get("dlspeed"), "seeds": t.get("num_seeds"),
        "ratio": round(t.get("ratio", 0), 2), "torrentState": t.get("state"), "messages": [], "error": None,
    } for h, t in torrents.items() if t.get("category") == category]


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

    def music():
        a = arr("lidarr", "artist") or []
        st = [x.get("statistics") or {} for x in a]
        return {"artists": len(a), "albums": sum(x.get("albumCount") or 0 for x in st),
                "tracks": sum(x.get("trackFileCount") or 0 for x in st),
                "size": sum(x.get("sizeOnDisk") or 0 for x in st)}

    def books():
        b = lazylibrarian("getAllBooks") or []
        b = b if isinstance(b, list) else []
        return {"total": len(b), "have": sum(1 for x in b if str(x.get("Status", "")).lower() == "open"),
                "wanted": len(lazylibrarian("getWanted") or [])}

    parts = {"movies": POOL.submit(movies), "series": POOL.submit(series),
             "music": POOL.submit(music), "books": POOL.submit(books)}
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


@cached(15)
def media():
    torrents = {}
    try:
        torrents = {t["hash"].lower(): t for t in (qb("torrents/info") or [])}
    except Exception:
        pass

    def q(app, kind, **extra):
        try:
            r = arr(app, "queue", pageSize=100, **extra)
            return queue_items(kind, (r or {}).get("records"), torrents)
        except Exception as e:
            return [{"kind": kind, "error": str(e)[:200], "title": f"{app} queue unavailable"}]

    parts = {
        "vpn": POOL.submit(vpn),
        "library": POOL.submit(library),
        "sizes": POOL.submit(media_sizes),
        "movies": POOL.submit(q, "radarr", "movies", includeMovie="true"),
        "series": POOL.submit(q, "sonarr", "series", includeSeries="true", includeEpisode="true"),
        "music": POOL.submit(q, "lidarr", "music", includeArtist="true", includeAlbum="true"),
    }
    res = {}
    for k, f in parts.items():
        try:
            res[k] = f.result(timeout=60)
        except Exception as e:
            res[k] = {"error": str(e)[:200]}
    queues = {"movies": res["movies"], "series": res["series"], "music": res["music"],
              "books": bare_torrents(torrents, "lazylibrarian", "books")}
    active = [t for t in torrents.values() if t.get("dlspeed") or t.get("state") in ("downloading", "stalledDL", "metaDL")]
    return {"time": int(time.time()), "vpn": res["vpn"], "library": res["library"], "sizes": res["sizes"],
            "queues": queues,
            "torrents": {"total": len(torrents), "downloading": len(active),
                         "seeding": sum(1 for t in torrents.values() if t.get("state", "").endswith(("UP", "uploading"))),
                         "errored": [t["name"][:80] for t in torrents.values() if "error" in t.get("state", "").lower()][:5]}}


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


def preview(action, vmid, path):
    checked_project(vmid, path)
    if action == "log":
        return {"log": pv(vmid, "log", path, "300")}
    return json.loads(pv(vmid, action, path, "--json", timeout=60))


def claude_code(action, vmid, path, profile="noven"):
    """start / stop / read a Claude Code session in the project's dev box"""
    checked_project(vmid, path)
    if action == "log":
        return {"log": pv(vmid, "cclog", path, "400", timeout=30)}
    if action == "stop":
        return json.loads(pv(vmid, "ccstop", path, "--json", timeout=30))
    if profile not in ("noven", "work"):
        raise ValueError("profile must be noven or work")
    return json.loads(pv(vmid, "cc", path, profile, "--json", timeout=60))


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
    "navidrome": (103, "docker", "navidrome"),
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
    "lidarr": (106, "docker", "lidarr"),
    "lazylibrarian": (106, "docker", "lazylibrarian"),
    "gluetun": (106, "docker", "gluetun"),
    "subgen": (105, "docker", "subgen"),
}
AI_CT = 105


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


def a_backup_ct(args):
    c = _ct(args)
    return f"back up CT {c['vmid']} {c['name']} (vzdump, snapshot mode)", [
        "vzdump", str(c["vmid"]), "--storage", "vzdump", "--mode", "snapshot", "--compress", "zstd",
        "--notes-template", "{{guestname}} (dashboard)"], 3 * 3600


def a_ct_start(args):
    c = _ct(args, running=False)
    return f"start CT {c['vmid']} {c['name']}", ["pct", "start", str(c["vmid"])], 300


def a_ct_shutdown(args):
    c = _ct(args, running=True)
    return f"shut down CT {c['vmid']} {c['name']}", ["pct", "shutdown", str(c["vmid"]), "--timeout", "90"], 300


def a_ct_reboot(args):
    c = _ct(args, running=True)
    return f"reboot CT {c['vmid']} {c['name']}", ["pct", "reboot", str(c["vmid"]), "--timeout", "90"], 300


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
    "backup_ct": a_backup_ct, "ct_start": a_ct_start, "ct_shutdown": a_ct_shutdown, "ct_reboot": a_ct_reboot,
    "service_restart": a_service_restart, "apt_upgrade": a_apt_upgrade,
    "apt_upgrade_all": a_apt_upgrade_all, "zfs_scrub": a_zfs_scrub,
    "unit_start": a_unit_start, "ollama_pull": a_ollama_pull, "ollama_stop": a_ollama_stop, "newdev": a_newdev,
    "git_push": a_git_push, "git_fetch": a_git_fetch, "project_new": a_project_new,
    "github_publish": a_github_publish,
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
        invalidate("updates", "ct_ports", "overview")


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


# --- http -------------------------------------------------------------------
@cached(3)
def overview():
    c = cts()
    parts = {"host": POOL.submit(host), "gpu": POOL.submit(gpu), "pools": POOL.submit(pools),
             "datasets": POOL.submit(datasets), "backups": POOL.submit(backups, c), "tailnet": POOL.submit(tailnet),
             "ports": POOL.submit(ports, c), "smart": POOL.submit(smart), "updates": POOL.submit(all_updates, c)}
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
            if u.path == "/cc/log":
                return self._send(200, claude_code("log", int(q["vmid"]), q["path"]))
            if u.path == "/preview/log":
                return self._send(200, preview("log", int(q["vmid"]), q["path"]))
            if u.path == "/action/status":
                return self._send(200, job_status(q["id"]))
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
            if u.path == "/action/check":
                return self._send(200, {"desc": check_action(str(body.get("name")), body.get("args"))})
            if u.path == "/action/run":
                return self._send(200, start_action(str(body.get("name")), body.get("args")))
            self._send(404, {"error": "not found"})
        except (ValueError, KeyError) as e:
            self._send(400, {"error": str(e)})

    def log_message(self, fmt, *args):
        if not self.path.startswith(("/overview", "/projects", "/media", "/preview/log", "/cc/log",
                                     "/action/status", "/github/repos")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    cpu_percent()
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
