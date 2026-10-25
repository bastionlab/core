"""Discord webhooks, one per channel of the homelab server. The dashboard sets them through the agent;
the file is copied into the CTs whose apps post (deals 107, money 108) and read on pve for host alerts.
A topic routed to push (Settings → Notifications, push.py) gets the agent's relay URL in that copy instead."""
import json, os, re, subprocess, tempfile, time, urllib.error, urllib.request
from pathlib import Path

from config import DASH_URL, HOST_IP, ct
import push as webpush

FILE = Path("/etc/dash/discord.json")
CHANNELS = ("deals", "wohnungen", "jobs", "money", "alerts")
CONSUMERS = tuple(c for c in (ct("deals"), ct("money")) if c)  # CTs that read /etc/discord.json
HOOK = re.compile(r"^https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+$")
UA = f"DiscordBot ({DASH_URL}, 1.0)"  # Cloudflare turns away urllib's default agent


def load():
    try:
        return json.loads(FILE.read_text())
    except (OSError, ValueError):
        return {}


def _req(url, data=None, method=None):
    req = urllib.request.Request(url, data=data and json.dumps(data).encode(), method=method,
                                 headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def view():
    """which channels are set, never the URLs themselves"""
    h = load()
    return {"channels": [{"key": k, "set": bool(h.get(k)), "name": (h.get("_names") or {}).get(k)} for k in CHANNELS]}


def for_cts():
    """the CTs' copy: real webhooks, or the relay on this agent for topics that push (it forwards to Discord itself)"""
    h = {k: v for k, v in load().items() if not k.startswith("_")}
    relay = None
    for ch in CHANNELS:
        if webpush.route(ch) != "discord":
            relay = relay or webpush.keys()["relay"]
            h[ch] = f"http://{HOST_IP}:{os.environ.get('AGENT_PORT', '7070')}/relay/{ch}/{relay}"
    return h


def push():
    """copy the file into every CT that posts; a stopped CT gets it on the next save"""
    out = {}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(for_cts(), f)
    try:
        for ct in CONSUMERS:
            r = subprocess.run(["pct", "push", str(ct), f.name, "/etc/discord.json", "--perms", "0600"],
                               capture_output=True, text=True, timeout=30)
            out[ct] = r.returncode == 0
    finally:
        os.unlink(f.name)
    return out


def set_hook(channel, url):
    if channel not in CHANNELS:
        raise ValueError("unknown channel")
    url = (url or "").strip()
    h = load()
    names = h.setdefault("_names", {})
    if url:
        if not HOOK.match(url):
            raise ValueError("keine Discord-Webhook-URL")
        try:
            names[channel] = _req(url).get("name")
        except (urllib.error.URLError, ValueError) as e:
            raise ValueError(f"Discord kennt diesen Webhook nicht ({e})")
        h[channel] = url
    else:
        h.pop(channel, None)
        names.pop(channel, None)
    FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(h, indent=1))
    os.chmod(tmp, 0o600)
    tmp.replace(FILE)
    return view() | {"pushed": push()}


def send(channel, content="", embeds=None, topic=None):
    """to Discord and/or push, as the topic (default: the channel) is routed. False when neither took it"""
    r = webpush.route(topic or channel)
    pushed = False
    if r in ("push", "both"):
        title, body = webpush.from_discord({"content": content, "embeds": embeds})
        pushed = webpush.notify(topic or channel, title, body)
    if r == "push":
        return pushed
    return _discord(channel, content, embeds) or pushed


def _discord(channel, content="", embeds=None):
    """False when the channel has no hook or Discord refused; one retry after a rate limit"""
    url = load().get(channel)
    if not url:
        return False
    body = {"content": content[:2000], "embeds": embeds or [], "allowed_mentions": {"parse": []}}
    if not embeds:
        body["flags"] = 4  # no link previews; with embeds this flag would hide them too
    for _ in range(2):
        try:
            _req(url + "?wait=true", body)
            return True
        except urllib.error.HTTPError as e:
            if e.code != 429:
                return False
            try:
                time.sleep(min(10, float(json.loads(e.read()).get("retry_after", 2))))
            except ValueError:
                time.sleep(2)
        except urllib.error.URLError:
            return False
    return False
