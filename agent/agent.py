#!/usr/bin/env python3
"""Bastion agent: the HTTP server the dashboard (CT 104) talks to.

Serves JSON to the dashboard CT only (source IP + bearer token). The data and the fixed set of things it can do
live in the modules imported below; nothing here runs a command the caller wrote.
"""
import base64, json, os, re, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from config import HOST_IP, ip
import hooks
import push
from core import HERE, POOL, cached, invalidate
from metrics import all_updates, backups, cpu_percent, cts, datasets, gpu, host, pools, ports, smart, tailnet
from actions import deploy_status, check_action, job_status, marketplace_index, marketplace_local, marketplace_scan, service_uptime, start_action
from claude import _alive, _cc_turn, claude_send, claude_stop, claude_usage, claude_watch
import backup
import release
import dash_sdk
import settings


BIND = os.environ.get("AGENT_BIND", HOST_IP)
PORT = int(os.environ.get("AGENT_PORT", "7070"))
ALLOW = set(os.environ.get("AGENT_ALLOW", f"{ip('dash')},{HOST_IP}").split(","))
TOKEN = (HERE / "token").read_text().strip()
# the CTs whose apps post Discord webhooks may reach /relay/… (push.py) — with the relay key, never the token
RELAY_FROM = ALLOW | {x for x in (ip("deals"), ip("money")) if x}
# add-on modules (addons/<id>/agent/*.py) register their routes with dash_sdk
dash_sdk.load_addons(HERE.parent / "addons")


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
        if self.client_address[0] not in ALLOW or not secrets.compare_digest(self.headers.get("Authorization", ""), f"Bearer {TOKEN}"):
            self._send(403, {"error": "forbidden"})
            return False
        return True

    def _fail(self, e):
        try:
            self._send(500, {"error": f"{type(e).__name__}: {e}"[:300]})
        except OSError:
            pass

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
            if u.path == "/action/status":
                return self._send(200, job_status(q["id"]))
            if u.path == "/claude/usage":
                return self._send(200, claude_usage())
            if u.path == "/claude/stream":
                return self._claude_stream(q["turn"], int(q.get("from", 0)))
            if u.path == "/discord":
                return self._send(200, hooks.view())
            if u.path == "/push":
                return self._send(200, push.view())
            if u.path == "/deploy":
                return self._send(200, deploy_status())
            if u.path == "/settings":
                return self._send(200, settings.view())
            if u.path == "/settings/values":
                return self._send(200, settings.values(q.get("addon", "")))
            if u.path == "/backup":
                return self._send(200, backup.view())
            if u.path == "/core":
                return self._send(200, release.fresh() if q.get("fresh") == "1" else release.check())
            if u.path == "/backup/preview":
                return self._send(200, backup.preview(q))
            if u.path == "/backup/file":
                return self._file(backup.path(q))
            if u.path == "/marketplace/index":
                if q.get("fresh") == "1":
                    invalidate("marketplace_index", "marketplace_local")
                return self._send(200, marketplace_index())
            if u.path == "/marketplace/local":
                return self._send(200, marketplace_local())
            if u.path == "/marketplace/scan":
                return self._send(200, marketplace_scan(q["id"]))
            if u.path in dash_sdk.STREAMS:
                return dash_sdk.STREAMS[u.path](self, q)
            fn, m = dash_sdk.route("GET", u.path)
            if fn:
                return self._send(200, fn(q, m) if m else fn(q))
            self._send(404, {"error": "not found"})
        except (ValueError, KeyError, TypeError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # a timeout or OSError deep in a helper: answer instead of dropping the connection
            self._fail(e)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.startswith("/relay/"):
            return self._relay(u)
        if not self._auth():
            return
        try:
            if u.path == "/backup/upload":  # raw bytes, not JSON
                return self._send(200, backup.upload(self, {k: v[0] for k, v in parse_qs(u.query).items()}))
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or "{}")
            if u.path == "/claude/send":
                return self._send(200, claude_send(str(body.get("chat")), str(body.get("session")), body.get("prompt"),
                                                   body.get("auto") is True, body.get("model"), body.get("effort"),
                                                   [i for i in body.get("images") or [] if isinstance(i, dict)], body.get("fork"),
                                                   body.get("team") is True, body.get("plan") is True, body.get("quiet") is True,
                                                   body.get("push") is not False))
            if u.path == "/claude/usage":
                return self._send(200, claude_usage(refresh=True))
            if u.path == "/claude/stop":
                return self._send(200, claude_stop(str(body.get("chat"))))
            if u.path == "/discord":
                return self._send(200, hooks.set_hook(str(body.get("channel")), str(body.get("url") or "")))
            if u.path == "/discord/test":
                ch = str(body.get("channel"))
                return self._send(200, {"sent": ch in hooks.CHANNELS and hooks.send(ch, f"✅ #{ch} ist mit dem Dashboard verbunden.")})
            if u.path == "/push":
                op = body.get("op")
                if op == "subscribe":
                    return self._send(200, push.subscribe(body.get("sub"), body.get("name"), body.get("topics")))
                if op == "topics":
                    return self._send(200, push.set_topics(str(body.get("id")), body.get("topics")))
                if op == "remove":
                    return self._send(200, push.remove(str(body.get("id"))))
                if op == "route":
                    return self._send(200, push.set_route(str(body.get("topic")), str(body.get("route"))))
                if op == "test":
                    return self._send(200, push.test(str(body.get("id"))))
                raise ValueError("unknown op")
            if u.path == "/action/check":
                return self._send(200, {"desc": check_action(str(body.get("name")), body.get("args"))})
            if u.path == "/action/run":
                return self._send(200, start_action(str(body.get("name")), body.get("args")))
            if u.path == "/settings/set":
                return self._send(200, settings.set_value(str(body.get("addon", "")), str(body.get("key", "")), body.get("value")))
            if u.path == "/settings/pin":
                return self._send(200, settings.set_pin(body.get("current"), body.get("new")))
            if u.path == "/backup/settings":
                return self._send(200, backup.set_settings(body))
            if u.path == "/core/channel":
                return self._send(200, release.set_channel(body))
            if u.path == "/backup/pass":
                return self._send(200, backup.set_pass(body))
            if u.path == "/settings/core":
                return self._send(200, settings.set_core(str(body.get("key", "")), body.get("value")))
            fn, m = dash_sdk.route("POST", u.path)
            if fn:
                return self._send(200, fn(body, m) if m else fn(body))
            self._send(404, {"error": "not found"})
        except (ValueError, KeyError, TypeError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # a timeout or OSError deep in a helper: answer instead of dropping the connection
            self._fail(e)

    def _file(self, path):
        """a file as a download (Settings → Backup)"""
        self.send_response(200)
        self.send_header("Content-Type", "application/gzip")
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self.end_headers()
        with path.open("rb") as f:
            while chunk := f.read(1 << 20):
                self.wfile.write(chunk)

    def _relay(self, u):
        """a Discord webhook post from a CT whose topic is routed to push (push.relay)"""
        parts = u.path.split("/")
        if self.client_address[0] not in RELAY_FROM or len(parts) != 4:
            return self._send(403, {"error": "forbidden"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 200_000:
                return self._send(413, {"error": "too big"})
            return self._send(200, push.relay(parts[2], parts[3], json.loads(self.rfile.read(n) or "{}"), u.query))
        except PermissionError:
            self._send(403, {"error": "forbidden"})
        except (ValueError, TypeError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:
            self._fail(e)

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
        if not self.path.startswith(("/overview", "/action/status", "/term/", "/claude/stream", "/claude/usage", *dash_sdk.QUIET)):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    cpu_percent()
    threading.Thread(target=claude_watch, daemon=True).start()
    for fn in dash_sdk.STARTUP:  # add-ons' background loops
        threading.Thread(target=fn, daemon=True).start()
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
