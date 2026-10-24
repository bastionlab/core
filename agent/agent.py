#!/usr/bin/env python3
"""pve dashboard agent: the HTTP server the dashboard (CT 104) talks to.

Serves JSON to the dashboard CT only (source IP + bearer token). The data and the fixed set of things it can do
live in the modules imported below; nothing here runs a command the caller wrote.
"""
import base64, json, os, re, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from config import HOST_IP, ip
import hooks
from core import HERE, POOL, cached
from metrics import all_updates, backups, cpu_percent, cts, datasets, gpu, host, pools, ports, smart, tailnet
from media import media, media_items, media_plan
from dev import _dims, _winsize, claude_code, preview, projects, shell_kill, shell_new, shells, ship_log, term_close, term_get, term_open, term_reaper
from github import github_repos
from games import games, games_do, games_log
from actions import check_action, job_status, marketplace_index, service_uptime, start_action
from claude import _alive, _cc_turn, claude_send, claude_stop, claude_usage
import dash_sdk


BIND = os.environ.get("AGENT_BIND", HOST_IP)
PORT = int(os.environ.get("AGENT_PORT", "7070"))
ALLOW = set(os.environ.get("AGENT_ALLOW", f"{ip('dash')},{HOST_IP}").split(","))
TOKEN = (HERE / "token").read_text().strip()
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
            if u.path == "/projects":
                return self._send(200, projects())
            if u.path == "/media":
                return self._send(200, media())
            if u.path == "/github/repos":
                return self._send(200, github_repos())
            if u.path == "/games":
                return self._send(200, games())
            if u.path == "/games/log":
                return self._send(200, games_log(q["id"], q.get("n", 300)))
            if u.path == "/media/items":
                return self._send(200, media_items())
            if u.path == "/media/plan":
                return self._send(200, media_plan(q.get("kind"), q.get("id"), q.get("seasons")))
            ansi = q.get("ansi") == "1"
            if u.path == "/cc/log":
                return self._send(200, claude_code("log", int(q["vmid"]), q["path"], ansi=ansi))
            if u.path == "/ship/log":
                return self._send(200, ship_log(int(q["vmid"]), q["path"], ansi))
            if u.path == "/preview/log":
                return self._send(200, preview("log", int(q["vmid"]), q["path"], ansi))
            if u.path == "/shells":
                return self._send(200, shells())
            if u.path == "/action/status":
                return self._send(200, job_status(q["id"]))
            if u.path == "/claude/usage":
                return self._send(200, claude_usage())
            if u.path == "/claude/stream":
                return self._claude_stream(q["turn"], int(q.get("from", 0)))
            if u.path == "/discord":
                return self._send(200, hooks.view())
            if u.path == "/term/stream":
                return self._term_stream(term_get(q["id"]), int(q.get("from", 0)))
            if u.path == "/marketplace/index":
                return self._send(200, marketplace_index())
            fn = dash_sdk.ROUTES.get(("GET", u.path))
            if fn:
                return self._send(200, fn(q))
            self._send(404, {"error": "not found"})
        except (ValueError, KeyError, TypeError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # a timeout or OSError deep in a helper: answer instead of dropping the connection
            self._fail(e)

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
            m = re.fullmatch(r"/games/([a-z-]+)", u.path)
            if m:
                return self._send(200, games_do(m[1], body))
            if u.path == "/term/open":
                return self._send(200, term_open(int(body["vmid"]), str(body.get("path", "")), str(body["target"]),
                                                 body.get("cols", 80), body.get("rows", 24), body.get("session")))
            if u.path == "/shells/new":
                return self._send(200, shell_new(int(body["vmid"])))
            if u.path == "/shells/kill":
                return self._send(200, shell_kill(int(body["vmid"]), str(body["session"])))
            if u.path == "/term/input":
                data = body.get("data", "")
                if not isinstance(data, str) or len(data) > 65536:
                    raise ValueError("bad input")
                term_get(body["id"]).write(data.encode())
                return self._send(200, {"ok": True})
            if u.path == "/term/resize":
                t = term_get(body["id"])
                _winsize(t.fd, *_dims(body["cols"], body["rows"]))
                return self._send(200, {"ok": True})
            if u.path == "/term/close":
                return self._send(200, term_close(body["id"]))
            if u.path == "/claude/send":
                return self._send(200, claude_send(str(body.get("chat")), str(body.get("session")), body.get("prompt"),
                                                   body.get("auto") is True, body.get("model"), body.get("effort"),
                                                   [i for i in body.get("images") or [] if isinstance(i, dict)]))
            if u.path == "/claude/usage":
                return self._send(200, claude_usage(refresh=True))
            if u.path == "/claude/stop":
                return self._send(200, claude_stop(str(body.get("chat"))))
            if u.path == "/discord":
                return self._send(200, hooks.set_hook(str(body.get("channel")), str(body.get("url") or "")))
            if u.path == "/discord/test":
                ch = str(body.get("channel"))
                return self._send(200, {"sent": ch in hooks.CHANNELS and hooks.send(ch, f"✅ #{ch} ist mit dem Dashboard verbunden.")})
            if u.path == "/action/check":
                return self._send(200, {"desc": check_action(str(body.get("name")), body.get("args"))})
            if u.path == "/action/run":
                return self._send(200, start_action(str(body.get("name")), body.get("args")))
            fn = dash_sdk.ROUTES.get(("POST", u.path))
            if fn:
                return self._send(200, fn(body))
            self._send(404, {"error": "not found"})
        except (ValueError, KeyError, TypeError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # a timeout or OSError deep in a helper: answer instead of dropping the connection
            self._fail(e)

    def _term_stream(self, t, pos):
        """server-sent events: `data:` = base64 of the pty output from byte offset `pos`, `event: end` when it exits"""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        t.readers += 1
        try:
            while True:
                with t.cond:
                    if pos - t.base >= len(t.buf) and t.alive:
                        t.cond.wait(15)
                    start = max(pos - t.base, 0)
                    chunk = bytes(t.buf[start:])
                    pos = t.base + len(t.buf)
                    alive = t.alive
                    t.seen = time.time()
                if chunk:
                    self.wfile.write(f"id: {pos}\ndata: {base64.b64encode(chunk).decode()}\n\n".encode())
                elif alive:
                    self.wfile.write(b": ping\n\n")
                if not alive:
                    self.wfile.write(b"event: end\ndata: \n\n")
                    self.wfile.flush()
                    return
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            t.readers -= 1
            t.seen = time.time()

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
        if not self.path.startswith(("/overview", "/projects", "/media", "/preview/log", "/cc/log", "/ship/log", "/shells",
                                     "/action/status", "/term/", "/claude/stream", "/claude/usage", "/github/repos", "/games", "/media/items", "/media/plan", *dash_sdk.QUIET)):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    cpu_percent()
    threading.Thread(target=term_reaper, daemon=True).start()
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
