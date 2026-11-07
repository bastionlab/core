"""Shared Google accounts: one OAuth client, each account's refresh token in /etc/dash/secrets/google.json.

Calendar (and later Mail) ask access_token(email) for a fresh bearer; nothing else leaves this module.
"""
import base64, json, secrets as _rand, threading, time, urllib.error, urllib.parse, urllib.request

import dash_sdk
from settings import SECRETS, _read, _write, secret

AID = "google"
REDIRECT = "https://dash.tail4219a6.ts.net/api/auth/google/callback"
SCOPE = "openid email https://www.googleapis.com/auth/calendar https://mail.google.com/"
_LOCK = threading.Lock()
_STATES: dict[str, float] = {}  # state -> expiry
_TOKENS: dict[str, tuple[str, float]] = {}  # email -> (access token, expiry)


def _put(key, value):
    with _LOCK:
        d = _read(SECRETS, AID)
        if value is None:
            d.pop(key, None)
        else:
            d[key] = {"value": value, "updated": int(time.time())}
        _write(SECRETS, AID, d, 0o600)


def client():
    return secret(AID, "client_id"), secret(AID, "client_secret")


def set_client(body):
    cid, sec = str(body.get("client_id") or "").strip(), str(body.get("client_secret") or "").strip()
    if cid:
        _put("client_id", cid)
    if sec:
        _put("client_secret", sec)
    if not (cid or sec):
        raise ValueError("client ID or secret required")
    return {"ok": True}


def auth_url(state):
    cid, _ = client()
    if not cid:
        raise ValueError("set the Google client ID and secret first")
    q = {"client_id": cid, "redirect_uri": REDIRECT, "response_type": "code", "access_type": "offline",
         "prompt": "consent", "include_granted_scopes": "true", "scope": SCOPE, "state": state}
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(q)


def _token_post(form):
    req = urllib.request.Request("https://oauth2.googleapis.com/token", urllib.parse.urlencode(form).encode(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e)
        except ValueError:
            err = {}
        if err.get("error") == "invalid_grant":
            raise ValueError("Google rejected the saved login (invalid_grant): reconnect this account")
        raise ValueError(f"Google: {err.get('error_description') or err.get('error') or e.code}")


def exchange(code):
    cid, sec = client()
    if not (cid and sec):
        raise ValueError("Google client not set")
    tok = _token_post({"code": code, "client_id": cid, "client_secret": sec, "redirect_uri": REDIRECT, "grant_type": "authorization_code"})
    email = ""
    try:
        mid = tok["id_token"].split(".")[1]
        email = json.loads(base64.urlsafe_b64decode(mid + "=" * (-len(mid) % 4))).get("email", "")
    except (KeyError, IndexError, ValueError):
        pass
    if not email:
        req = urllib.request.Request("https://openidconnect.googleapis.com/v1/userinfo", headers={"Authorization": f"Bearer {tok['access_token']}"})
        with urllib.request.urlopen(req, timeout=20) as r:
            email = json.load(r).get("email", "")
    if not email:
        raise ValueError("Google did not return an email")
    email = email.lower()
    if not tok.get("refresh_token"):
        raise ValueError("Google sent no refresh token: remove Bastion at myaccount.google.com/permissions and connect again")
    _put(f"refresh:{email}", tok["refresh_token"])
    _TOKENS[email] = (tok["access_token"], time.time() + int(tok.get("expires_in", 3600)) - 60)
    return email


def access_token(email):
    email = email.lower()
    hit = _TOKENS.get(email)
    if hit and hit[1] > time.time():
        return hit[0]
    rt = secret(AID, f"refresh:{email}")
    cid, sec = client()
    if not rt:
        raise ValueError(f"{email} is not connected")
    tok = _token_post({"refresh_token": rt, "client_id": cid, "client_secret": sec, "grant_type": "refresh_token"})
    _TOKENS[email] = (tok["access_token"], time.time() + int(tok.get("expires_in", 3600)) - 60)
    return tok["access_token"]


def accounts():
    out = []
    for k, v in _read(SECRETS, AID).items():
        if k.startswith("refresh:"):
            email = k[8:]
            ok = bool(v.get("value"))
            out.append({"email": email, "ok": ok, "detail": "connected" if ok else "reconnect"})
    return out


def disconnect(email):
    email = str(email or "").lower()
    _TOKENS.pop(email, None)
    _put(f"refresh:{email}", None)
    return {"ok": True}


@dash_sdk.get("/google/accounts")
def _accounts(q):
    cid, sec = client()
    return {"client_id": cid or "", "has_secret": bool(sec), "accounts": accounts(), "redirect": REDIRECT}


@dash_sdk.post("/google/start")
def _start(body):
    now = time.time()
    for s in [s for s, t in _STATES.items() if t < now]:
        _STATES.pop(s, None)
    state = _rand.token_urlsafe(24)
    _STATES[state] = now + 600
    return {"url": auth_url(state)}


@dash_sdk.get("/google/callback")
def _callback(q):
    if q.get("error"):
        raise ValueError(f"Google: {q['error']}")
    if _STATES.pop(q.get("state", ""), 0) < time.time():
        raise ValueError("unknown or expired state")
    return {"email": exchange(q["code"])}


@dash_sdk.post("/google/disconnect")
def _disconnect(body):
    return disconnect(body.get("email"))


@dash_sdk.post("/google/client")
def _client(body):
    return set_client(body)
