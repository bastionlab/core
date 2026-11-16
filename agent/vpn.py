"""Remote access: which VPN reaches Bastion from outside. The choice lives in /etc/dash/vpn.json; each provider can report
its state and connect. Nothing here ever takes Tailscale down: switching the choice only records it (and sets the other
provider up when asked), so a wrong click cannot lock the owner out."""
import ipaddress, json, os, re, shutil, subprocess
from pathlib import Path

from config import CFG

PROVIDERS = {
    "tailscale": "Tailscale",
    "headscale": "Headscale (self-hosted Tailscale)",
    "netbird": "NetBird",
    "wireguard": "WireGuard (plain, own keys)",
    "none": "None (home network only)",
}
STORE = Path(os.environ.get("DASH_VPN_STORE", "/etc/dash/vpn.json"))
WG_DIR = Path(os.environ.get("DASH_WG_DIR", "/etc/wireguard"))
WG_NET = ipaddress.ip_network("10.77.0.0/24")
WG_PORT = 51820


def _run(cmd, inp=None, timeout=30):
    return subprocess.run(cmd, input=inp, capture_output=True, text=True, timeout=timeout, cwd="/tmp")


def _chosen():
    try:
        return json.loads(STORE.read_text()).get("provider", "tailscale")
    except Exception:
        return "tailscale"


def set_provider(p):
    if p not in PROVIDERS:
        raise ValueError("unknown provider")
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps({"provider": p}))
    STORE.chmod(0o600)
    return view()


def _tailscale():
    if not shutil.which("tailscale"):
        return {"installed": False, "up": False, "detail": "not installed"}
    try:
        j = json.loads(_run(["tailscale", "status", "--json"]).stdout)
        up = j.get("BackendState") == "Running"
        me = j.get("Self") or {}
        return {"installed": True, "up": up, "detail": (me.get("DNSName") or "").rstrip(".") if up else j.get("BackendState", "stopped"),
                "server": (j.get("CurrentTailnet") or {}).get("Name")}
    except Exception as e:
        return {"installed": True, "up": False, "detail": str(e)[:80]}


def _netbird():
    if not shutil.which("netbird"):
        return {"installed": False, "up": False, "detail": "not installed"}
    out = _run(["netbird", "status"]).stdout
    up = bool(re.search(r"Management:\s*Connected", out))
    return {"installed": True, "up": up, "detail": "connected" if up else "not connected"}


def _wg_conf():
    return WG_DIR / "wg0.conf"


def _wireguard():
    if not shutil.which("wg"):
        return {"installed": False, "up": False, "detail": "wireguard-tools missing"}
    if not _wg_conf().exists():
        return {"installed": True, "up": False, "set": False, "detail": "not set up"}
    up = _run(["wg", "show", "wg0"]).returncode == 0
    peers = len(re.findall(r"^\[Peer\]", _wg_conf().read_text(), re.M))
    return {"installed": True, "up": up, "set": True, "peers": peers, "port": WG_PORT, "detail": f"{peers} device(s)" if up else "interface down"}


def view():
    st = {"tailscale": _tailscale(), "netbird": _netbird(), "wireguard": _wireguard()}
    st["headscale"] = {**st["tailscale"], "detail": st["tailscale"]["detail"] + " (tailscale client)"}
    st["none"] = {"installed": True, "up": True, "detail": "LAN address only"}
    return {"provider": _chosen(), "providers": [{"id": k, "name": v, **st[k]} for k, v in PROVIDERS.items()],
            "lan": CFG.get("lan", {}).get("host_ip")}


def connect(provider, a):
    """headscale: point the tailscale client at your server; netbird: join with a setup key. Both need the owner's own key."""
    if provider == "headscale":
        url, key = str(a.get("server") or ""), str(a.get("key") or "")
        if not re.fullmatch(r"https?://[A-Za-z0-9.:-]+(/[A-Za-z0-9._~/-]*)?", url):
            raise ValueError("server must look like https://headscale.example.com")
        if not re.fullmatch(r"[A-Za-z0-9._-]{10,200}", key):
            raise ValueError("auth key looks wrong")
        r = _run(["tailscale", "up", "--login-server", url, "--authkey", key, "--accept-dns=false"], timeout=60)
    elif provider == "netbird":
        key = str(a.get("key") or "")
        if not shutil.which("netbird"):
            raise ValueError("netbird is not installed on pve: install it first (https://docs.netbird.io/how-to/getting-started#installation)")
        if not re.fullmatch(r"[A-Za-z0-9-]{10,100}", key):
            raise ValueError("setup key looks wrong")
        url = str(a.get("server") or "")
        cmd = ["netbird", "up", "--setup-key", key]
        if url:
            if not re.fullmatch(r"https://[A-Za-z0-9.:-]+", url):
                raise ValueError("management URL must be https://host")
            cmd += ["--management-url", url]
        r = _run(cmd, timeout=90)
    else:
        raise ValueError("nothing to connect for this provider")
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip()[-200:] or "failed")
    set_provider(provider)
    return view()


# --- WireGuard: one server interface on pve, one peer per phone/laptop ----------------------------------------
def _wg(cmd, inp=None):
    r = _run(["wg", *cmd], inp)
    if r.returncode:
        raise ValueError(r.stderr.strip()[-160:] or "wg failed")
    return r.stdout.strip()


def wg_init():
    if not shutil.which("wg"):
        raise ValueError("wireguard-tools is not installed (apt install wireguard-tools)")
    if _wg_conf().exists():
        return view()
    WG_DIR.mkdir(parents=True, exist_ok=True)
    priv = _wg(["genkey"])
    nic = (re.search(r"dev (\S+)", _run(["ip", "route", "show", "default"]).stdout) or [None, "vmbr0"])[1]
    _wg_conf().write_text(f"""[Interface]
Address = {WG_NET[1]}/24
ListenPort = {WG_PORT}
PrivateKey = {priv}
PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -s {WG_NET} -o {nic} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -s {WG_NET} -o {nic} -j MASQUERADE
""")
    _wg_conf().chmod(0o600)
    if os.environ.get("DASH_VPN_NOSTART") != "1":
        r = _run(["systemctl", "enable", "--now", "wg-quick@wg0"], timeout=60)
        if r.returncode:
            raise ValueError(r.stderr.strip()[-160:])
    set_provider("wireguard")
    return view()


def wg_peer(name, endpoint):
    name = re.sub(r"[^A-Za-z0-9_-]", "", name or "")[:24] or "device"
    if not re.fullmatch(r"[A-Za-z0-9.-]+", endpoint or ""):
        raise ValueError("endpoint: your public host name or IP (where UDP 51820 is forwarded to this server)")
    if not _wg_conf().exists():
        raise ValueError("set WireGuard up first")
    conf = _wg_conf().read_text()
    if f"# peer {name}\n" in conf:
        raise ValueError("a device with that name exists")
    used = {ipaddress.ip_address(m) for m in re.findall(r"AllowedIPs = (10\.77\.0\.\d+)/32", conf)}
    ip = next(h for h in WG_NET.hosts() if h not in used and h != WG_NET[1])
    priv = _wg(["genkey"])
    pub, psk = _wg(["pubkey"], priv), _wg(["genpsk"])
    server_pub = _wg(["pubkey"], re.search(r"PrivateKey = (\S+)", conf)[1])
    with _wg_conf().open("a") as f:
        f.write(f"\n# peer {name}\n[Peer]\nPublicKey = {pub}\nPresharedKey = {psk}\nAllowedIPs = {ip}/32\n")
    if _run(["wg", "show", "wg0"]).returncode == 0:
        _wg(["set", "wg0", "peer", pub, "preshared-key", "/dev/stdin", "allowed-ips", f"{ip}/32"], psk)
    lan = (CFG.get("lan") or {}).get("subnet")
    routes = ", ".join([str(WG_NET)] + ([lan] if lan else []))
    client = f"""[Interface]
PrivateKey = {priv}
Address = {ip}/32

[Peer]
PublicKey = {server_pub}
PresharedKey = {psk}
Endpoint = {endpoint}:{WG_PORT}
AllowedIPs = {routes}
PersistentKeepalive = 25
"""
    return {"name": name, "config": client}
