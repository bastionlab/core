"""Claude sign-in from the browser: `claude auth login` runs in a pty on pve, the page shows its URL, the owner opens it,
signs in and pastes the code back. Credentials land in /root/.claude/.credentials.json like a terminal login."""
import json, os, pty, re, select, signal, subprocess, threading, time

CLAUDE = "/root/.local/bin/claude"
_lock = threading.Lock()
_s = {"proc": None, "fd": None, "buf": "", "at": 0, "mode": "claudeai"}
_URL = re.compile(r"https://[^\s\x1b\x07]+")
_ANSI = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]")


def status():
    try:
        r = subprocess.run([CLAUDE, "auth", "status"], capture_output=True, text=True, timeout=20, cwd="/tmp", env={**os.environ, "HOME": "/root"})
        j = json.loads(r.stdout)
        return {"loggedIn": bool(j.get("loggedIn")), "email": j.get("email"), "method": j.get("authMethod"), "expires": j.get("loginExpiresAt")}
    except Exception as e:
        return {"loggedIn": False, "error": str(e)[:120]}


def _reap():
    p = _s["proc"]
    if p and p.poll() is None:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except Exception:
            p.kill()
        p.wait()
    if _s["fd"] is not None:
        try:
            os.close(_s["fd"])
        except OSError:
            pass
    _s.update(proc=None, fd=None)


def _read(fd, proc):
    while True:
        try:
            r, _, _ = select.select([fd], [], [], 1)
            if r:
                d = os.read(fd, 4096)
                if not d:
                    return
                _s["buf"] += d.decode(errors="replace")
            elif proc.poll() is not None:
                return
        except OSError:
            return


def start(mode="claudeai"):
    mode = "console" if mode == "console" else "claudeai"
    with _lock:
        _reap()
        m, s = pty.openpty()
        p = subprocess.Popen([CLAUDE, "auth", "login", f"--{mode}"], stdin=s, stdout=s, stderr=s, close_fds=True, cwd="/tmp",
                             start_new_session=True, env={**os.environ, "HOME": "/root", "BROWSER": "true"})
        os.close(s)
        _s.update(proc=p, fd=m, buf="", at=time.time(), mode=mode)
        threading.Thread(target=_read, args=(m, p), daemon=True).start()
    for _ in range(40):
        u = _url()
        if u or p.poll() is not None:
            break
        time.sleep(0.25)
    return view()


def _url():
    m = _URL.search(_ANSI.sub("", _s["buf"]).replace("]8;;", ""))
    return m.group(0).rstrip("]") if m else None


def view():
    p = _s["proc"]
    running = bool(p and p.poll() is None)
    if running and time.time() - _s["at"] > 600:  # a code is only good for a few minutes
        with _lock:
            _reap()
        running = False
    return {"running": running, "url": _url() if running else None, **status()}


def code(text):
    text = (text or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._#~+/=-]{8,400}", text):
        raise ValueError("that does not look like a login code")
    p = _s["proc"]
    if not (p and p.poll() is None):
        raise ValueError("no login running: start again")
    os.write(_s["fd"], (text + "\r").encode())
    for _ in range(60):
        if p.poll() is not None:
            break
        time.sleep(0.5)
    ok = p.poll() == 0
    out = _ANSI.sub("", _s["buf"]).strip().splitlines()
    with _lock:
        _reap()
    st = status()
    if not (ok and st["loggedIn"]):
        raise ValueError((out[-1] if out else "login failed")[:160])
    return {"running": False, **st}


def cancel():
    with _lock:
        _reap()
    return view()
