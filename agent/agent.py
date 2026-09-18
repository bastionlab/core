#!/usr/bin/env python3
"""pve dashboard agent — read-only host data plus a fixed set of dev-preview actions.

Serves JSON to the dashboard CT only (source IP + bearer token). It never runs caller-supplied
commands: previews go through `pv` inside a CT tagged `dev`, for a project path that `pv ls` listed.
"""
import json, os, re, subprocess, threading, time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
BIND = os.environ.get("AGENT_BIND", "192.168.1.50")
PORT = int(os.environ.get("AGENT_PORT", "7070"))
ALLOW = set(os.environ.get("AGENT_ALLOW", "192.168.1.50,192.168.1.50").split(","))
TOKEN = (HERE / "token").read_text().strip()
TSKEY = Path("/root/devbox/keys/tailscale_authkey")
TSKEY_DAYS = 90
PV = "/usr/local/bin/pv"
POOL = ThreadPoolExecutor(8)


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
            if u.path == "/preview/log":
                return self._send(200, preview("log", int(q["vmid"]), q["path"]))
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
            self._send(404, {"error": "not found"})
        except (ValueError, KeyError) as e:
            self._send(400, {"error": str(e)})

    def log_message(self, fmt, *args):
        if not self.path.startswith(("/overview", "/projects", "/preview/log")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    cpu_percent()
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
