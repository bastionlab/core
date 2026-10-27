"""Web Push to the dashboard on phones/desktops (Settings → Notifications), next to the Discord webhooks.

Each topic (alerts, backups, deals, …) goes to Discord, push or both. Host alerts route here through hooks.send();
the apps in the deals/money CTs post Discord webhooks themselves, so for a topic that pushes, their
/etc/discord.json gets a relay URL on this agent instead (hooks.push()): relay() pushes the message and forwards
it to the real webhook when the topic still goes to Discord too.

VAPID keys + the relay key: /etc/dash/secrets/push.json (root only). Devices and routes: /var/lib/dash/push.json.
Encryption is RFC 8291 (aes128gcm) with VAPID (RFC 8292), done here with `cryptography`, no extra packages.
"""
import base64, hashlib, json, os, re, secrets, struct, threading, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from config import DASH_URL

KEYS = Path("/etc/dash/secrets/push.json")
STATE = Path("/var/lib/dash/push.json")
# topic → (label, page a tap opens). Discord channel = the topic, except backups (posted to #alerts)
TOPICS = {"alerts": ("Alerts", "/metrics"), "backups": ("Backups", "/metrics#backups"), "deals": ("Deals", "/deals"),
          "wohnungen": ("Flats", "/wohnungen"), "jobs": ("Jobs", "/jobs"), "money": ("Money", "/money"),
          "chat": ("Chat", "/chat")}
ROUTES = ("discord", "push", "both")
_lock = threading.Lock()


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _write(path, obj, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, indent=1))
    os.chmod(tmp, mode)
    tmp.replace(path)


def keys():
    """made on first use; the public half is what browsers subscribe with"""
    try:
        k = json.loads(KEYS.read_text())
        if k.get("private") and k.get("relay"):
            return k
    except (OSError, ValueError):
        pass
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    k = {"private": b64u(priv.private_numbers().private_value.to_bytes(32, "big")), "public": b64u(pub),
         "relay": secrets.token_hex(24)}
    KEYS.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(KEYS.parent, 0o700)
    _write(KEYS, k)
    return k


def load():
    try:
        s = json.loads(STATE.read_text())
    except (OSError, ValueError):
        s = {}
    s.setdefault("subs", [])
    s.setdefault("routes", {})
    return s


def route(topic):
    r = load()["routes"].get(topic)
    return r if r in ROUTES else "discord"


def _sid(endpoint):
    return hashlib.sha256(endpoint.encode()).hexdigest()[:12]


def view():
    s = load()
    return {"key": keys()["public"], "topics": [{"key": k, "label": v[0], "route": route(k)} for k, v in TOPICS.items()],
            "devices": [{"id": _sid(d["endpoint"]), "name": d.get("name") or "Device", "topics": d.get("topics", []),
                         "added": d.get("added"), "last": d.get("last"), "failed": d.get("failed", 0)} for d in s["subs"]]}


# --- what the dashboard can change --------------------------------------------------------------------------
ENDPOINT = re.compile(r"^https://[\w.-]+(:\d+)?/[\w./%~+=:-]+$")


def subscribe(sub, name, topics):
    """upsert by endpoint; a new device starts with every topic"""
    ep = str((sub or {}).get("endpoint") or "")
    k = (sub or {}).get("keys") or {}
    if not ENDPOINT.match(ep) or len(ep) > 1000:
        raise ValueError("bad push endpoint")
    if len(unb64u(str(k.get("p256dh", "")))) != 65 or len(unb64u(str(k.get("auth", "")))) != 16:
        raise ValueError("bad push keys")
    with _lock:
        s = load()
        cur = next((d for d in s["subs"] if d["endpoint"] == ep), None)
        if not cur:
            cur = {"endpoint": ep, "added": int(time.time()), "topics": list(TOPICS)}
            s["subs"].append(cur)
        cur["keys"] = {"p256dh": k["p256dh"], "auth": k["auth"]}
        cur["name"] = str(name or cur.get("name") or "Device")[:60]
        if topics is not None:
            cur["topics"] = [t for t in topics if t in TOPICS]
        cur["failed"] = 0
        _write(STATE, s)
    return {"id": _sid(ep)} | view()


def set_topics(sid, topics):
    with _lock:
        s = load()
        d = next((d for d in s["subs"] if _sid(d["endpoint"]) == sid), None)
        if not d:
            raise ValueError("unknown device")
        d["topics"] = [t for t in topics or [] if t in TOPICS]
        _write(STATE, s)
    return view()


def remove(sid):
    with _lock:
        s = load()
        s["subs"] = [d for d in s["subs"] if _sid(d["endpoint"]) != sid]
        _write(STATE, s)
    return view()


def set_route(topic, r):
    if topic not in TOPICS or r not in ROUTES:
        raise ValueError("unknown topic or route")
    with _lock:
        s = load()
        s["routes"][topic] = r
        _write(STATE, s)
    import hooks  # the CTs' webhook file changes with the route (relay URL or the real one)
    return view() | {"pushed": hooks.push()}


# --- sending ------------------------------------------------------------------------------------------------
def _vapid(endpoint, k):
    u = urllib.parse.urlparse(endpoint)
    head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    claims = b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": DASH_URL}).encode())
    priv = ec.derive_private_key(int.from_bytes(unb64u(k["private"]), "big"), ec.SECP256R1())
    r, s = decode_dss_signature(priv.sign(f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
    return f"vapid t={head}.{claims}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}, k={k['public']}"


def _encrypt(sub, data: bytes):
    """RFC 8291: one aes128gcm record"""
    ua_pub = unb64u(sub["keys"]["p256dh"])
    auth = unb64u(sub["keys"]["auth"])
    eph = ec.generate_private_key(ec.SECP256R1())
    as_pub = eph.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = eph.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub))
    ikm = HKDF(hashes.SHA256(), 32, auth, b"WebPush: info\x00" + ua_pub + as_pub).derive(shared)
    salt = os.urandom(16)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    body = AESGCM(cek).encrypt(nonce, data + b"\x02", None)
    return salt + struct.pack("!IB", 4096, len(as_pub)) + as_pub + body


def _send_one(sub, payload, k, urgency):
    req = urllib.request.Request(sub["endpoint"], data=_encrypt(sub, payload), method="POST", headers={
        "Authorization": _vapid(sub["endpoint"], k), "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": urgency})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return 0


def notify(topic, title, body="", url=None, only=None):
    """push to every device that has this topic on (or just `only`, a device id); False if none took it"""
    if topic not in TOPICS and topic != "test":
        return False
    k = keys()
    label, page = TOPICS.get(topic, ("Test", "/settings"))
    payload = json.dumps({"title": (title or label)[:120], "body": (body or "")[:400], "url": url or page,
                          "tag": f"{topic}-{int(time.time() * 1000) % 100000}", "topic": topic}).encode()
    urgency = "high" if topic in ("alerts", "backups") else "normal"
    subs = [d for d in load()["subs"] if (only and _sid(d["endpoint"]) == only) or (not only and topic in d.get("topics", []))]
    results = {d["endpoint"]: _send_one(d, payload, k, urgency) for d in subs}
    with _lock:  # 404/410 = the browser dropped the subscription: forget it; other failures are counted
        s = load()
        for d in s["subs"]:
            rc = results.get(d["endpoint"])
            if rc is None:
                continue
            if 200 <= rc < 300:
                d["last"], d["failed"] = int(time.time()), 0
            else:
                d["failed"] = d.get("failed", 0) + 1
        s["subs"] = [d for d in s["subs"] if results.get(d["endpoint"]) not in (404, 410)]
        _write(STATE, s)
    return any(200 <= rc < 300 for rc in results.values())


def test(sid):
    return {"sent": notify("test", "✅ Push works", "Notifications from the dashboard reach this device.", only=sid)}


# --- Discord messages → a notification ------------------------------------------------------------------------
def _plain(t):
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t or "")
    t = re.sub(r"[*_`~]{1,3}", "", t)
    return re.sub(r"<[^>]+>", "", t).strip()


def from_discord(payload):
    """title + body from a webhook body (content and/or embeds)"""
    lines = [_plain(payload.get("content") or "")]
    for e in (payload.get("embeds") or [])[:2]:
        lines += [_plain(e.get("title") or ""), _plain(e.get("description") or "")]
        lines += [f"{_plain(f.get('name'))}: {_plain(f.get('value'))}" for f in (e.get("fields") or [])[:4]]
    lines = [x for x in "\n".join(lines).splitlines() if x.strip()]
    return (lines[0][:120] if lines else ""), "\n".join(lines[1:])[:400]


def relay(channel, key, payload, query):
    """POST /relay/<channel>/<key> from the deals/money CTs: push, then forward to Discord if the topic still goes there"""
    if not secrets.compare_digest(key, keys()["relay"]) or channel not in TOPICS:
        raise PermissionError("bad relay key")
    import hooks
    r = route(channel)
    if r in ("push", "both"):
        title, body = from_discord(payload)
        threading.Thread(target=notify, args=(channel, title, body), daemon=True).start()
    if r in ("discord", "both"):
        url = hooks.load().get(channel)
        if url:
            try:
                return hooks._req(url + (f"?{query}" if query else ""), payload)
            except urllib.error.HTTPError as e:
                return {"status": e.code}
    return {}
