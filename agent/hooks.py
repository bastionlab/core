"""Discord webhooks, one per channel of the homelab server. The dashboard sets them through the agent;
the file is copied into the CTs whose apps post (deals 107, money 108) and read on pve for host alerts."""
import json, os, re, subprocess, time, urllib.error, urllib.request
from pathlib import Path

FILE = Path("/etc/dash/discord.json")
CHANNELS = ("deals", "wohnungen", "jobs", "money", "alerts")
CONSUMERS = (107, 108)  # CTs that read /etc/discord.json
HOOK = re.compile(r"^https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+$")
UA = "DiscordBot (https://dash.example-tailnet.ts.net, 1.0)"  # Cloudflare turns away urllib's default agent


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


def push():
    """copy the file into every CT that posts; a stopped CT gets it on the next save"""
    out = {}
    for ct in CONSUMERS:
        r = subprocess.run(["pct", "push", str(ct), str(FILE), "/etc/discord.json", "--perms", "0600"],
                           capture_output=True, text=True, timeout=30)
        out[ct] = r.returncode == 0
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


def send(channel, content="", embeds=None):
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
