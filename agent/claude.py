"""Claude chat: `claude -p` on the host, one transient systemd unit per turn"""
import base64, json, os, re, shutil, subprocess, time
from pathlib import Path

from core import sh
from metrics import unit


# --- Claude chat: `claude -p` on the host, one transient systemd unit per turn ------------------
# The unit writes stream-json to a file and the browser tails that file, so a turn keeps running through a
# dropped phone connection, a page reload and the agent restart that deploy.sh does. Read-only by default
# (dontAsk: only read-only commands + RO_ALLOW, everything else is denied without asking); `auto` hands the
# turn to Claude Code's auto mode, where the classifier (and settings.json autoMode rules) still gate each step.
# Reachable only behind the dashboard PIN (web/server/middleware/auth.ts).
CLAUDE = "/root/.local/bin/claude"
CC_DIR = Path("/var/lib/dash-claude")
CC_KEEP_DAYS = 30
RO_ALLOW = [
    "Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite", "Task", "Agent",
    "Bash(pct list)", "Bash(pct config *)", "Bash(pct status *)", "Bash(pct df *)", "Bash(qm list)",
    "Bash(pvesh get *)", "Bash(pvesm status *)", "Bash(pvesm status)", "Bash(pveversion *)", "Bash(pveversion)",
    "Bash(zfs list *)", "Bash(zfs list)", "Bash(zfs get *)", "Bash(zpool status *)", "Bash(zpool status)",
    "Bash(zpool list *)", "Bash(zpool list)", "Bash(systemctl status *)", "Bash(systemctl list-units *)",
    "Bash(systemctl list-timers *)", "Bash(systemctl is-active *)", "Bash(journalctl *)", "Bash(df *)", "Bash(free *)",
    "Bash(sensors *)", "Bash(sensors)", "Bash(nvidia-smi *)", "Bash(nvidia-smi)", "Bash(tailscale status *)",
    "Bash(tailscale status)", "Bash(ip a *)", "Bash(ip a)", "Bash(ss -tlnp *)", "Bash(ss -tlnp)", "Bash(uptime)",
    "Bash(git log *)", "Bash(git status *)", "Bash(git diff *)", "Bash(git show *)",
    "Bash(pct exec * -- cat *)", "Bash(pct exec * -- ls *)", "Bash(pct exec * -- tail *)", "Bash(pct exec * -- df *)",
    "Bash(pct exec * -- journalctl *)", "Bash(pct exec * -- systemctl status *)", "Bash(pct exec * -- docker ps *)",
    "Bash(pct exec 104 -- curl -s http://127.0.0.1:3000/api/*)",
]
CC_SYSTEM = """You are answering in the Chat tab of the owner's homelab dashboard (https://dash.example-tailnet.ts.net), as root on the Proxmox host pve, cwd /root. The owner is often on a phone: keep answers short, use markdown, and avoid wide tables and long code dumps unless they are asked for.
Dashboard source: /root/dashboard (agent/agent.py runs on pve, web/ is Nuxt in CT 104). Deploy with ./deploy.sh. It restarts the agent and the app, and this conversation survives that because it runs in its own systemd unit. Another Claude session may be editing the dashboard at the same time, so check `git status` and file mtimes before touching a file, and never revert work you didn't do.
The Notes tab's notes are JSON at `pct exec 104 -- curl -s http://127.0.0.1:3000/api/notes`. When the owner says "build my note about X", read it there first.
QUESTIONS: you have no AskUserQuestion tool here. When the owner should decide something (which approach, which option, missing details), end your answer with ONE fenced block and stop, without guessing ahead:
```questions
[{"header": "Storage", "q": "Where should the notes database live?", "multi": false,
  "options": [{"label": "CT 104 (Recommended)", "description": "rides along in the nightly backup"}, {"label": "tank", "description": "…"}]}]
```
1-4 questions, 2-4 options each, a header of at most 12 characters, the recommended option first and marked "(Recommended)". "multi": true lets several be picked. The dashboard renders this as tap-to-answer buttons with a free-text "Other", and the answers arrive as the next message. Keep the prose above the block short.
"""
CC_RO = """MODE: READ-ONLY. You can read files and run read-only commands, and anything that would change state is denied automatically. Don't work around a denial. When a fix needs a change, say exactly what you would change and tell the owner to switch on **Auto** in the chat header and ask again."""
CC_AUTO = """MODE: AUTO. The owner switched on write access for this message. You may edit files, run commands, deploy and restart services. Nobody approves individual steps, so prefer reversible changes, don't delete data, and keep the scope to what was asked. Finish with a short list of what you changed and how to undo it."""
CC_MODELS = ("fable", "opus", "sonnet", "haiku")
CC_EFFORTS = ("low", "medium", "high", "xhigh", "max")
CC_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _cc_unit(chat):
    if not re.fullmatch(r"[a-z0-9]{4,16}", chat or ""):
        raise ValueError("bad chat id")
    return f"dash-claude-{chat}"


def _cc_pid(unit):
    try:
        return int(sh("systemctl", "show", "-p", "MainPID", "--value", unit).strip() or 0)
    except ValueError:
        return 0


def _cc_cleanup():
    cutoff = time.time() - CC_KEEP_DAYS * 86400
    for f in CC_DIR.glob("*"):
        try:
            if f.stat().st_mtime < cutoff:
                shutil.rmtree(f) if f.is_dir() else f.unlink()
        except OSError:
            pass


def claude_send(chat, session, prompt, auto, model=None, effort=None, images=None):
    unit = _cc_unit(chat)
    if not CC_UUID.fullmatch(session or ""):
        raise ValueError("bad session id")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 200_000:
        raise ValueError("empty or too long message")
    if model not in (None, *CC_MODELS) or effort not in (None, *CC_EFFORTS):
        raise ValueError("unknown model or effort")
    if _cc_pid(unit):
        raise ValueError("Claude is still answering in this chat — stop it first")
    CC_DIR.mkdir(mode=0o700, exist_ok=True)
    _cc_cleanup()
    turn = f"{chat}-{int(time.time() * 1000)}"
    # a session Claude Code already stored is resumed, an unknown id starts one under that id
    known = any(Path("/root/.claude/projects").glob(f"*/{session}.jsonl"))
    # screenshots / files dropped into the chat: saved next to the turn, Claude opens them with Read (it sees images and PDFs)
    paths, shots = [], 0
    for i, im in enumerate((images or [])[:8]):
        name = str(im.get("name", ""))
        if re.fullmatch(r"[a-f0-9]{24}\.(jpg|png|webp)", name):
            f, shots = CC_DIR / f"{turn}-{i}.{name.rsplit('.', 1)[-1]}", shots + 1
        elif m := re.fullmatch(r"[a-f0-9]{24}-([\w.-]{1,100})", name):
            d = CC_DIR / f"{turn}-{i}"  # own folder so the file keeps its real name
            d.mkdir(mode=0o700, exist_ok=True)
            f = d / m[1].lstrip(".")
        else:
            continue
        f.write_bytes(base64.b64decode(im.get("data", "")))
        paths.append(str(f))
    if paths:
        what = "a screenshot" if shots == len(paths) == 1 else f"{len(paths)} screenshots" if shots == len(paths) else \
               "a file" if len(paths) == 1 else f"{len(paths)} files"
        prompt += f"\n\n[The owner attached {what}. Look at " + ("it" if len(paths) == 1 else "them") + \
                  " first (Read handles images, PDFs and text; use Bash for archives or binaries): " + ", ".join(paths) + "]"
    # the prompt goes in on stdin: as one argv entry a long paste hits the kernel's 128 KiB per-argument limit, and
    # a message starting with "-" would be read as an option
    (CC_DIR / f"{turn}.prompt").write_text(prompt)
    cmd = [CLAUDE, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
           "--resume" if known else "--session-id", session, "--permission-prompts", "none",
           "--append-system-prompt", CC_SYSTEM + (CC_AUTO if auto else CC_RO),
           "--disallowedTools", "AskUserQuestion"]
    cmd += ["--model", model] if model else []
    cmd += ["--effort", effort] if effort else []
    if auto:
        cmd += ["--permission-mode", "auto"]
    else:
        cmd += ["--permission-mode", "dontAsk", "--allowedTools", *RO_ALLOW,
                "--disallowedTools", "Write", "Edit", "NotebookEdit"]
    out = CC_DIR / f"{turn}.jsonl"
    r = subprocess.run(["systemd-run", "--unit", unit, "--collect", "--quiet",
                        "-p", "WorkingDirectory=/root", "-p", f"StandardInput=file:{CC_DIR / f'{turn}.prompt'}",
                        "-p", f"StandardOutput=file:{out}", "-p", f"StandardError=file:{CC_DIR / f'{turn}.err'}",
                        "-p", "RuntimeMaxSec=3h",
                        "-E", "HOME=/root", "-E", "CLAUDE_PROFILE=noven", "-E", "TERM=dumb",
                        "-E", "PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                        *cmd], capture_output=True, text=True, timeout=20)
    if r.returncode:
        raise ValueError(f"could not start claude: {r.stderr.strip()[:300]}")
    pid = _cc_pid(unit)
    (CC_DIR / f"{turn}.json").write_text(json.dumps({"chat": chat, "session": session, "auto": bool(auto),
                                                      "pid": pid, "t0": _starttime(pid), "started": time.time()}))
    return {"turn": turn, "resumed": known}


def _cc_last_limits(path):
    """the newest rate_limit_event in a stream-json file (one per API call, carries the subscription windows)"""
    info = None
    try:
        with open(path, "rb") as f:
            for line in f:
                if b'"rate_limit_event"' in line:
                    info = json.loads(line).get("rate_limit_info") or info
    except (OSError, ValueError):
        pass
    return info


def claude_usage(refresh=False):
    """5-hour + weekly subscription use as Claude Code last saw it: from the newest chat turn, or — on refresh — from
    a one-word Haiku call (≈3 s, a negligible slice of the window). Covers the whole account, terminal sessions too."""
    snap = CC_DIR / "usage.json"
    if refresh:
        r = subprocess.run([CLAUDE, "-p", "ok", "--model", "haiku", "--effort", "low", "--no-session-persistence",
                            "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk", "--tools", ""],
                           capture_output=True, text=True, timeout=60, cwd="/tmp",
                           env={**os.environ, "HOME": "/root", "CLAUDE_PROFILE": "noven"})
        info = next((json.loads(l)["rate_limit_info"] for l in r.stdout.splitlines() if '"rate_limit_event"' in l), None)
        if not info:
            raise ValueError(f"no usage in claude's answer: {(r.stderr or r.stdout).strip()[-200:]}")
        CC_DIR.mkdir(mode=0o700, exist_ok=True)
        snap.write_text(json.dumps({"info": info, "at": time.time()}))
    best = json.loads(snap.read_text()) if snap.exists() else None
    for f in sorted(CC_DIR.glob("*.jsonl"), key=lambda f: f.stat().st_mtime, reverse=True)[:10]:
        if best and f.stat().st_mtime <= best["at"]:
            break
        info = _cc_last_limits(f)
        if info:
            best = {"info": info, "at": f.stat().st_mtime}
            break
    if not best:
        return {"at": None, "windows": {}}
    i = best["info"]
    return {"at": int(best["at"]), "status": i.get("status"), "limited": i.get("rateLimitType") if i.get("status") == "rejected" else None,
            "windows": {k: {"used": v.get("utilization"), "resets": v.get("resetsAt")} for k, v in (i.get("unifiedWindows") or {}).items()}}


def claude_stop(chat):
    sh("systemctl", "stop", _cc_unit(chat))
    return {"ok": True}


def _cc_turn(turn):
    if not re.fullmatch(r"[a-z0-9]{4,16}-\d{13}", turn or ""):
        raise ValueError("bad turn id")
    meta = CC_DIR / f"{turn}.json"
    if not meta.exists():
        raise ValueError("unknown turn")
    return json.loads(meta.read_text()), CC_DIR / f"{turn}.jsonl", CC_DIR / f"{turn}.err"


def _starttime(pid):
    """field 22 of /proc/<pid>/stat: identifies this process even after its pid is reused"""
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19] if pid > 0 else None
    except (OSError, IndexError):
        return None


def _alive(meta):
    return meta.get("pid", 0) > 0 and _starttime(meta["pid"]) == meta.get("t0")
