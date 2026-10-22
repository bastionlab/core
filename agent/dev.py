"""dev boxes: `pv` previews and Claude Code sessions, web shells, and the full-screen terminal (tmux on a pty)"""
import fcntl, json, os, pty, re, secrets, signal, struct, subprocess, termios, threading, tty, time

from core import POOL, PV
from metrics import cts


# --- dev previews ------------------------------------------------------------
def dev_cts():
    return [c for c in cts() if "dev" in c["tags"] and c["type"] == "lxc"]


def pv(vmid, *args, timeout=30):
    r = subprocess.run(["pct", "exec", str(vmid), "--", PV, *args], capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "pv failed")
    return r.stdout


def projects():
    def one(c):
        if c["status"] != "running":
            return {**c, "projects": [], "error": "stopped"}
        try:
            return {**c, "projects": json.loads(pv(c["vmid"], "ls", "--json"))}
        except Exception as e:
            return {**c, "projects": [], "error": str(e)}
    return list(POOL.map(one, dev_cts()))


def checked_project(vmid, path):
    if not any(c["vmid"] == vmid and c["status"] == "running" for c in dev_cts()):
        raise ValueError(f"CT {vmid} is not a running dev box")
    known = [p["path"] for p in json.loads(pv(vmid, "ls", "--json"))]
    if path not in known:
        raise ValueError(f"unknown project {path}")
    return path


def preview(action, vmid, path, ansi=False):
    checked_project(vmid, path)
    if action == "log":
        return json.loads(pv(vmid, "log", path, "300", "--ansi")) if ansi else {"log": pv(vmid, "log", path, "300")}
    return json.loads(pv(vmid, action, path, "--json", timeout=60))


def claude_code(action, vmid, path, profile="noven", ansi=False):
    """start / stop / read a Claude Code session in the project's dev box"""
    checked_project(vmid, path)
    if action == "log":
        if ansi:
            return json.loads(pv(vmid, "cclog", path, "400", "--ansi", timeout=30))
        return {"log": pv(vmid, "cclog", path, "400", timeout=30)}
    if action == "stop":
        return json.loads(pv(vmid, "ccstop", path, "--json", timeout=30))
    if profile not in ("noven", "work"):
        raise ValueError("profile must be noven or work")
    return json.loads(pv(vmid, "cc", path, profile, "--json", timeout=60))


def ship_log(vmid, path, ansi=False):
    """the /conduct conductor's pane (claude-base parallel lanes); read only"""
    checked_project(vmid, path)
    if ansi:
        return json.loads(pv(vmid, "shiplog", path, "400", "--ansi", timeout=30))
    return {"log": pv(vmid, "shiplog", path, "400", timeout=30)}


# --- shells: fresh login shells in a dev box, as max, each in its own tmux session on a private
# socket ("web") so it survives closing the browser, a flaky phone connection and agent restarts.
# That outer tmux is invisible: no status bar, no prefix key, no alternate screen (so the browser keeps
# the scrollback), and $TMUX is unset inside, so `tmux attach -t ship` works from the shell as usual.
SHELL_TMUX = ["tmux", "-L", "web"]
SHELL_RE = re.compile(r"sh-\d{1,4}")
SHELL_SETUP = ["set", "-g", "status", "off", ";", "set", "-g", "prefix", "None", ";", "set", "-g", "prefix2", "None", ";",
               "set", "-g", "escape-time", "0", ";", "set", "-g", "history-limit", "20000", ";",
               "set", "-g", "default-terminal", "tmux-256color", ";", "set", "-g", "window-size", "latest", ";",
               "set", "-ga", "terminal-overrides", ",xterm*:smcup@:rmcup@", ";", "set", "-g", "mouse", "off"]


def dev_box(vmid):
    c = next((c for c in dev_cts() if c["vmid"] == vmid and c["status"] == "running"), None)
    if not c:
        raise ValueError(f"CT {vmid} is not a running dev box")
    return c


def _shell_tmux(vmid, *args, timeout=20):
    # a login environment (HOME, PATH, LANG of max) so the shells it starts look like an ssh login
    # always quote: max's login shell is zsh, where a bare "=sh-1" is expanded as a command path
    cmd = " ".join("'" + a.replace("'", "'\\''") + "'" for a in (*SHELL_TMUX, *args))
    return subprocess.run(["pct", "exec", str(vmid), "--", "runuser", "-l", "max", "-c", cmd],
                          capture_output=True, text=True, timeout=timeout)


def shells():
    def one(c):
        r = _shell_tmux(c["vmid"], "list-sessions", "-F",
                        "#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_current_command}\t#{pane_current_path}")
        out = []
        for line in r.stdout.splitlines() if r.returncode == 0 else []:
            name, created, attached, cmd, cwd = (line.split("\t") + [""] * 5)[:5]
            if SHELL_RE.fullmatch(name):
                out.append({"session": name, "created": int(created or 0), "attached": int(attached or 0),
                            "command": cmd, "cwd": cwd.replace("/home/max", "~", 1)})
        out.sort(key=lambda x: int(x["session"][3:]))
        return {"vmid": c["vmid"], "name": c["name"], "shells": out}
    return list(POOL.map(one, [c for c in dev_cts() if c["status"] == "running"]))


def shell_new(vmid):
    dev_box(vmid)
    taken = {int(s["session"][3:]) for s in next((b["shells"] for b in shells() if b["vmid"] == vmid), [])}
    name = f"sh-{next(i for i in range(1, 10000) if i not in taken)}"
    r = _shell_tmux(vmid, "-f", "/dev/null", "new-session", "-d", "-s", name, "-x", "120", "-y", "40", "-c", "/home/max",
                    "exec env -u TMUX -u TMUX_PANE zsh -l", ";", *SHELL_SETUP)
    if r.returncode:
        raise ValueError((r.stderr or r.stdout).strip() or "could not start a shell")
    return {"vmid": vmid, "session": name}


def shell_kill(vmid, session):
    dev_box(vmid)
    if not SHELL_RE.fullmatch(session):
        raise ValueError("not a shell session")
    _shell_tmux(vmid, "kill-session", "-t", "=" + session)
    return {"killed": session}


# --- full-screen terminal: a real `tmux attach` on a pty, streamed to the browser ---------
# Only ever attaches to a project's own preview / Claude session (names come from `pv ls`), as max.
# Closing detaches the client; the tmux session keeps running.
TERMS = {}
TERMS_LOCK = threading.Lock()
TERM_BUF = 1 << 20          # keep at most 1 MiB of output for reconnects
TERM_IDLE = 90              # seconds without a stream reader before the client is detached
DEFAULT_SIZE = {"preview": (140, 45), "cc": (140, 45), "ship": None, "shell": None}  # what pv creates; restored on close


def _winsize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _dims(cols, rows):
    cols, rows = int(cols), int(rows)
    if not (20 <= cols <= 500 and 5 <= rows <= 200):
        raise ValueError("bad terminal size")
    return cols, rows


class Term:
    def __init__(self, vmid, session, target, cols, rows):
        self.vmid, self.session, self.target = vmid, session, target
        self.buf, self.base = bytearray(), 0   # base = stream offset of buf[0]
        self.cond = threading.Condition()
        self.alive, self.readers, self.seen = True, 0, time.time()
        tmux = SHELL_TMUX if target == "shell" else ["tmux"]
        attach = [*tmux, "attach", "-t", "=" + session]
        self.view = None
        if target == "ship":
            # The ship session is usually also open on the desktop (kitty, 4 lanes side by side). A plain attach
            # from a phone shrank every lane to phone width and shared one current window, so switching windows
            # in the browser flipped the desktop too. Instead: a throwaway session grouped with it (same windows,
            # its own current window), destroyed as soon as this view detaches. Sizes follow window-size latest:
            # the window fits whichever screen typed last. (ignore-size was tried: a forgotten kitty client then
            # pinned 315x73 and the browser only saw a cut-out of it — empty right edge, clipped input line.)
            self.view = f"{session}-web-{secrets.token_hex(3)}"
            cur = subprocess.run(["pct", "exec", str(vmid), "--", "runuser", "-u", "max", "--", "tmux", "display",
                                  "-p", "-t", f"={session}:", "#{window_index}"], capture_output=True, text=True, timeout=15)
            attach = ["tmux", "new-session", "-t", "=" + session, "-s", self.view, ";",
                      "set", "destroy-unattached", "on"]
            if cur.stdout.strip().isdigit():
                attach += [";", "select-window", "-t", ":" + cur.stdout.strip()]
        pid, fd = pty.fork()
        if pid == 0:
            tty.setraw(0)
            os.execvp("pct", ["pct", "exec", str(vmid), "--", "env", "TERM=xterm-256color", "LANG=C.UTF-8",
                              "runuser", "-u", "max", "--", *attach])
        self.pid, self.fd = pid, fd
        _winsize(fd, cols, rows)
        threading.Thread(target=self._rawout, daemon=True).start()
        threading.Thread(target=self._pump, daemon=True).start()

    def _rawout(self, until=None):
        """lxc-attach (pct exec) switches our side of the pty back to OPOST|ONLCR on start, so tmux's cursor-down
        "\n" arrived as "\r\n": a right-hand pane's next row was painted from column 0, over the left pane (the
        ship lanes smearing each other). Undo that as soon as it appears; _pump re-checks before every read."""
        until = until or time.time() + 5
        while self.alive:
            try:
                a = termios.tcgetattr(self.fd)
                if a[1] & (termios.OPOST | termios.ONLCR):
                    a[1] &= ~(termios.OPOST | termios.ONLCR)
                    termios.tcsetattr(self.fd, termios.TCSANOW, a)
            except (termios.error, OSError):
                return
            if time.time() > until:
                return
            time.sleep(0.02)

    def _pump(self):
        while True:
            try:
                self._rawout(until=1)  # one check
                data = os.read(self.fd, 65536)
            except OSError:
                data = b""
            with self.cond:
                if not data:
                    self.alive = False
                    self.cond.notify_all()
                    return
                self.buf += data
                if len(self.buf) > TERM_BUF:
                    cut = len(self.buf) - TERM_BUF
                    del self.buf[:cut]
                    self.base += cut
                self.cond.notify_all()

    def write(self, data: bytes):
        os.write(self.fd, data)

    def close(self):
        try:
            os.kill(self.pid, signal.SIGTERM)
            os.waitpid(self.pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass
        if self.view:  # destroy-unattached normally already took it
            subprocess.run(["pct", "exec", str(self.vmid), "--", "runuser", "-u", "max", "--", "tmux",
                            "kill-session", "-t", "=" + self.view], capture_output=True, timeout=15)
        # hand the window back its usual size, and let the next attach resize it again
        size = DEFAULT_SIZE[self.target]
        if not size:  # the ship session follows whoever attached last anyway
            return
        w, h = size
        subprocess.run(["pct", "exec", str(self.vmid), "--", "runuser", "-u", "max", "--", "tmux",
                        "resize-window", "-t", self.session, "-x", str(w), "-y", str(h), ";",
                        "set-window-option", "-t", self.session, "window-size", "latest"],
                       capture_output=True, timeout=15)


def term_open(vmid, path, target, cols, rows, session=None):
    cols, rows = _dims(cols, rows)
    if target == "shell":
        dev_box(vmid)
        if not SHELL_RE.fullmatch(str(session)) or _shell_tmux(vmid, "has-session", "-t", f"={session}").returncode:
            raise ValueError(f"no shell {session} in CT {vmid}")
        tid = secrets.token_urlsafe(18)
        with TERMS_LOCK:
            TERMS[tid] = Term(vmid, session, target, cols, rows)
        return {"id": tid, "session": session}
    checked_project(vmid, path)
    if target not in ("preview", "cc", "ship"):
        raise ValueError("target must be preview, cc, ship or shell")
    p = next(p for p in json.loads(pv(vmid, "ls", "--json")) if p["path"] == path)
    if target == "ship":
        session, alive = (p.get("ship") or {}).get("session"), (p.get("ship") or {}).get("running")
    elif target == "cc":
        session, alive = p["cc"]["session"], p["cc"]["running"]
    else:
        session, alive = p["session"], p["running"] or p.get("exited") is not None
    if not alive:
        raise ValueError(f"{session} is not running")
    tid = secrets.token_urlsafe(18)
    with TERMS_LOCK:
        TERMS[tid] = Term(vmid, session, target, cols, rows)
    return {"id": tid, "session": session}


def term_get(tid):
    t = TERMS.get(str(tid))
    if not t:
        raise ValueError("terminal is closed")
    return t


def term_close(tid):
    with TERMS_LOCK:
        t = TERMS.pop(str(tid), None)
    if t:
        t.close()
    return {"closed": bool(t)}


def term_reaper():
    while True:
        time.sleep(15)
        now = time.time()
        for tid, t in list(TERMS.items()):
            if (not t.alive) or (t.readers == 0 and now - t.seen > TERM_IDLE):
                threading.Thread(target=term_close, args=(tid,), daemon=True).start()
