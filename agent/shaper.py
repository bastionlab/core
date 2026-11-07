"""Bandwidth limits + priorities per CT, with tc/HTB on the physical NIC (upload = nic0 egress, download = nic0 ingress via ifb0).
State in /etc/dash/shaper.json: {enabled, down, up (Mbit/s total, 0 = no total cap), cts: {<key>: {prio 1 (first) - 7, down, up (Mbit/s cap, 0 = none)}}}.
LAN traffic (lan.subnet) is never shaped. Re-applied on agent start since tc is lost on reboot."""
import json, os, re, subprocess
from pathlib import Path

from config import CFG, HOST_IP

FILE = Path("/etc/dash/shaper.json")
BIG = 10000  # Mbit/s: "unlimited"


def _run(*a):
    return subprocess.run(a, capture_output=True, text=True).returncode == 0


def _nic():
    try:
        for m in sorted(os.listdir("/sys/class/net/vmbr0/brif")):
            if not m.startswith(("veth", "tap", "fw")):
                return m
    except OSError:
        pass
    return "vmbr0"


def _targets():
    out = []
    for k, v in (CFG.get("cts") or {}).items():
        if v.get("ip"):
            out.append({"key": k, "id": v.get("id"), "ip": v["ip"]})
    for i, a in enumerate(CFG.get("devbox", {}).get("ips") or []):
        out.append({"key": f"dev{CFG['devbox']['ids'][i]}", "id": CFG["devbox"]["ids"][i], "ip": a})
    return out


def _load():
    try:
        return json.loads(FILE.read_text())
    except Exception:
        return {"enabled": False, "down": 0, "up": 0, "cts": {}}


def state():
    s = _load()
    return {**s, "nic": _nic(), "targets": _targets(), "active": os.path.exists("/sys/class/net/ifb0") and _active()}


def _active():
    r = subprocess.run(["tc", "qdisc", "show", "dev", _nic()], capture_output=True, text=True).stdout
    return "htb" in r


def _tree(dev, total, cts, match):
    lan = (CFG.get("lan") or {}).get("subnet") or "192.168.0.0/16"
    _run("tc", "qdisc", "del", "dev", dev, "root")
    _run("tc", "qdisc", "add", "dev", dev, "root", "handle", "1:", "htb", "default", "99")
    t = total or BIG
    _run("tc", "class", "add", "dev", dev, "parent", "1:", "classid", "1:1", "htb", "rate", f"{BIG}mbit")
    # LAN-local traffic bypasses the cap
    _run("tc", "class", "add", "dev", dev, "parent", "1:1", "classid", "1:98", "htb", "rate", f"{BIG}mbit", "prio", "0")
    _run("tc", "filter", "add", "dev", dev, "parent", "1:", "protocol", "ip", "prio", "1", "u32",
         "match", "ip", "dst" if match == "src" else "src", lan, "flowid", "1:98")
    # internet pool
    _run("tc", "class", "add", "dev", dev, "parent", "1:1", "classid", "1:2", "htb", "rate", f"{t}mbit", "ceil", f"{t}mbit")
    _run("tc", "class", "add", "dev", dev, "parent", "1:2", "classid", "1:99", "htb", "rate", "1mbit", "ceil", f"{t}mbit", "prio", "4")
    _run("tc", "qdisc", "add", "dev", dev, "parent", "1:99", "fq_codel")
    for n, (ipa, c) in enumerate(cts, 10):
        mx = min(int(c.get("max") or t), t)
        mn = min(1, mx)
        _run("tc", "class", "add", "dev", dev, "parent", "1:2", "classid", f"1:{n}", "htb", "rate", f"{mn}mbit", "ceil", f"{mx}mbit",
             "prio", str(int(c.get("prio") or 4)))
        _run("tc", "qdisc", "add", "dev", dev, "parent", f"1:{n}", "fq_codel")
        _run("tc", "filter", "add", "dev", dev, "parent", "1:", "protocol", "ip", "prio", "2", "u32",
             "match", "ip", match, ipa + "/32", "flowid", f"1:{n}")


def clear():
    nic = _nic()
    _run("tc", "qdisc", "del", "dev", nic, "root")
    _run("tc", "qdisc", "del", "dev", nic, "ingress")
    _run("tc", "qdisc", "del", "dev", "ifb0", "root")


def apply():
    s = _load()
    clear()
    if not s.get("enabled"):
        return
    nic = _nic()
    if not os.path.exists("/sys/class/net/ifb0"):
        _run("modprobe", "ifb", "numifbs=1")
        if not os.path.exists("/sys/class/net/ifb0"):
            _run("ip", "link", "add", "ifb0", "type", "ifb")
    _run("ip", "link", "set", "ifb0", "up")
    ips = {t["key"]: t["ip"] for t in _targets()}
    cts = [(ips[k], c) for k, c in (s.get("cts") or {}).items() if k in ips]
    _tree(nic, int(s.get("up") or 0), [(a, {**c, "max": c.get("up")}) for a, c in cts], "src")
    _run("tc", "qdisc", "add", "dev", nic, "handle", "ffff:", "ingress")
    _run("tc", "filter", "add", "dev", nic, "parent", "ffff:", "protocol", "ip", "u32", "match", "u32", "0", "0",
         "action", "mirred", "egress", "redirect", "dev", "ifb0")
    _tree("ifb0", int(s.get("down") or 0), [(a, {**c, "max": c.get("down")}) for a, c in cts], "dst")


def _n(v, hi=BIG):
    try:
        return max(0, min(int(float(v)), hi))
    except (TypeError, ValueError):
        return 0


def save(body):
    keys = {t["key"] for t in _targets()}
    s = {"enabled": body.get("enabled") is True, "down": _n(body.get("down")), "up": _n(body.get("up")), "cts": {}}
    for k, c in (body.get("cts") or {}).items():
        if k in keys and isinstance(c, dict):
            s["cts"][k] = {"prio": max(1, min(_n(c.get("prio")) or 4, 7)),
                           "down": _n(c.get("down")), "up": _n(c.get("up"))}
    FILE.write_text(json.dumps(s, indent=1))
    apply()
    return state()
