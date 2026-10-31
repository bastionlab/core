"""host, storage, backups, containers, ports, updates and the tailnet: the read-only half of /overview"""
import os, re, subprocess, threading, time, urllib.request
from collections import deque
from pathlib import Path

from config import NAME, NODE, STORAGE
from core import FAN, JOBS, JOBS_LOCK, TSKEY, TSKEY_DAYS, cached, js, sh


# --- network throughput -----------------------------------------------------
_net = deque(maxlen=120)  # (t, rx_bytes, tx_bytes), one per 5 s
_net_if = None
_speed = None
_NIC_SKIP = ("lo", "veth", "tap", "fwbr", "fwpr", "fwln", "tailscale", "vmbr", "docker", "br-")


def _net_counters():
    out = {}
    for line in Path("/proc/net/dev").read_text().splitlines()[2:]:
        name, _, rest = line.partition(":")
        f = rest.split()
        if len(f) >= 9:
            out[name.strip()] = (int(f[0]), int(f[8]))
    return out


def _net_iface(cur):
    """the physical NIC: a bridge port of the default route's bridge (vmbr0 itself misses container traffic)"""
    try:
        dev = re.search(r"default .*?dev (\S+)", sh("ip", "-4", "route", "show", "default") or "")
        for n in sorted(os.listdir(f"/sys/class/net/{dev.group(1)}/brif")) if dev else []:
            if n in cur and not n.startswith(_NIC_SKIP):
                return n
    except OSError:
        pass
    if "nic0" in cur:
        return "nic0"
    c = [n for n in cur if not n.startswith(_NIC_SKIP)]
    return max(c, key=lambda n: sum(cur[n]), default=None)


def net_sample():
    global _net_if
    cur = _net_counters()
    if _net_if not in cur:
        _net_if = _net_iface(cur)
        _net.clear()
    if _net_if:
        _net.append((time.time(), *cur[_net_if]))


def net_loop():
    while True:
        try:
            net_sample()
        except Exception:
            pass
        time.sleep(5)


def net_start():
    threading.Thread(target=net_loop, daemon=True).start()


def net():
    s = list(_net)
    rates = []
    for a, b in zip(s, s[1:]):
        dt = b[0] - a[0]
        rates.append([round(max(0, b[1] - a[1]) / dt) if dt > 0 else 0, round(max(0, b[2] - a[2]) / dt) if dt > 0 else 0])
    last = rates[-1] if rates else [0, 0]
    return {"down": last[0], "up": last[1], "iface": _net_if, "history": rates, "speedtest": _speed}


def speedtest():
    """on-demand download measurement (reads only; nothing on the box changes)"""
    global _speed
    n, t0 = 0, time.time()
    req = urllib.request.Request("https://speed.cloudflare.com/__down?bytes=25000000", headers={"User-Agent": "Bastion-speedtest/1.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        while (b := r.read(262144)):
            n += len(b)
    secs = max(time.time() - t0, 0.001)
    _speed = {"mbit": round(n * 8 / secs / 1e6, 1), "bytes": n, "secs": round(secs, 2), "at": int(time.time())}
    return _speed


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
    st = js("pvesh", "get", f"/nodes/{NODE}/status", "--output-format", "json", default={})
    mem = st.get("memory", {})
    sensors = js("sensors", "-j", default={}) or {}
    temps = {}
    for chip, label, key in (("coretemp-isa-0000", "Package id 0", "cpu"), ("nvme-pci-0200", "Composite", "nvme")):
        try:
            temps[key] = round(sensors[chip][label]["temp1_input"], 1)
        except Exception:
            pass
    return {
        "name": NAME,
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


@cached(300)
def pool_names():
    """ZFS pools: storage.pools in the config, else whatever `zpool list` reports ([] without ZFS)"""
    if STORAGE.get("pools"):
        return list(STORAGE["pools"])
    try:
        return sh("zpool", "list", "-H", "-o", "name").split()
    except Exception:
        return []


@cached(300)
def replica_pools():
    """pools that only hold syncoid replicas (storage.replica_pools, else those with "backup" in the name)"""
    return list(STORAGE.get("replica_pools") or [p for p in pool_names() if "backup" in p])


@cached(300)
def snapshot_units():
    """sanoid/syncoid services: storage.snapshot_units in the config, else the sanoid*/syncoid* timers installed"""
    if STORAGE.get("snapshot_units"):
        return list(STORAGE["snapshot_units"])
    try:
        out = sh("systemctl", "list-unit-files", "--no-legend", "--type=timer", "sanoid*", "syncoid*")
    except Exception:
        return []
    return [l.split()[0][:-6] + ".service" for l in out.splitlines() if l.split() and l.split()[0].endswith(".timer")]


def datasets():
    out = []
    src = [p for p in pool_names() if p not in replica_pools()]
    for line in (sh("zfs", "list", "-Hp", "-o", "name,used,avail,mountpoint", "-r", *src).splitlines() if src else []):
        name, used, avail, mp = line.split("\t")
        out.append({"name": name, "used": int(used), "avail": int(avail), "mountpoint": mp})
    return out


def snapshots():
    """newest snapshot per dataset → sanoid (source pools) and syncoid (replica pools) freshness"""
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


def _snap_unit(prefix):
    u = next((u for u in snapshot_units() if u.startswith(prefix)), None)
    if not u:
        return {"result": "", "state": None, "last": None, "next": None, "installed": False}
    return {**unit(u), "installed": True}


def backups(cts):
    content = js("pvesh", "get", f"/nodes/{NODE}/storage/vzdump/content", "--output-format", "json", default=[]) or []
    per = {}
    for b in content:
        v = b.get("vmid")
        if v and b.get("ctime", 0) > per.get(v, {}).get("time", 0):
            per[v] = {"time": b["ctime"], "size": b.get("size"), "count": 0}
    for b in content:
        if b.get("vmid") in per:
            per[b["vmid"]]["count"] += 1
    snaps = snapshots()
    rep = replica_pools()
    src = [p for p in pool_names() if p not in rep]
    jobs = js("pvesh", "get", "/cluster/backup", "--output-format", "json", default=[]) or []
    tasks = js("pvesh", "get", f"/nodes/{NODE}/tasks", "--typefilter", "vzdump", "--limit", "14", "--output-format", "json",
               default=[]) or []
    return {
        "vzdump": [{"vmid": c["vmid"], "name": c["name"], **per.get(c["vmid"], {"time": None, "size": None, "count": 0}),
                    "run": vzdump_run(c["vmid"])} for c in cts],
        "history": [{"time": t.get("starttime"), "end": t.get("endtime"), "status": t.get("status"), "id": t.get("id") or None}
                    for t in tasks],
        "vzdumpJobs": [{"schedule": j.get("schedule"), "enabled": j.get("enabled", 1), "storage": j.get("storage"),
                        "all": j.get("all")} for j in jobs],
        "busy": backup_busy(),
        "sanoid": {**_snap_unit("sanoid"),
                   "datasets": [{"name": k, **v} for k, v in sorted(snaps.items()) if k.split("/")[0] in src]},
        "syncoid": {**_snap_unit("syncoid"),
                    "datasets": [{"name": k, **v} for k, v in sorted(snaps.items()) if k.split("/")[0] in rep]},
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
    res = dict(zip([c["vmid"] for c in running], FAN.map(lambda c: ct_ports(c["vmid"]), running)))
    host = {"listen": parse_ss(sh("ss", "-tlnpH")),
            "serve": parse_serve(js("tailscale", "serve", "status", "--json", default=None), NODE)}
    return {"host": host, "cts": {str(k): v for k, v in res.items()}}


@cached(3600)
def updates(vmid=None):
    cmd = ["apt", "list", "--upgradable"]
    out = sh(*cmd) if vmid is None else sh("pct", "exec", str(vmid), "--", *cmd, timeout=30)
    pkgs = [l.split("/", 1)[0] for l in out.splitlines() if "/" in l and "upgradable" in l]
    return {"count": len(pkgs), "packages": pkgs[:30], "checked": int(time.time())}


def all_updates(ctlist):
    running = [c["vmid"] for c in ctlist if c["status"] == "running" and c["type"] == "lxc"]
    res = dict(zip(running, FAN.map(updates, running)))
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


def backup_busy():
    """reasons a vzdump should not start right now. Snapshot mode does not stop or freeze anything, but only one
    vzdump runs at a time, it takes a lock on each guest, and it competes with an upgrade for disk I/O."""
    out = []
    tasks = js("pvesh", "get", f"/nodes/{NODE}/tasks", "--source", "active", "--output-format", "json", default=[]) or []
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
