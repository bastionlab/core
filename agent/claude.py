"""Claude chat: `claude -p` on the host, one transient systemd unit per turn"""
import base64, json, os, re, shutil, subprocess, time
from pathlib import Path

from config import DASH_URL, DASHBOARD, NAME, ct
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
    f"Bash(pct exec {ct('dash')} -- curl -s http://127.0.0.1:3000/api/*)",
    f"Bash({DASHBOARD}/agent/local-sum *)", f"Bash({DASHBOARD}/agent/local-sum)",
]
CC_SYSTEM = """You are answering in the Chat tab of the owner's homelab dashboard (__DASH_URL__), as root on the Proxmox host __NAME__, cwd /root. The owner is often on a phone: keep answers short, use markdown, and avoid wide tables and long code dumps unless they are asked for. Never use emoji, emoji in headings or decorative symbols.
Dashboard source: __DASHBOARD__ (agent/agent.py runs on __NAME__, web/ is Nuxt in CT __DASH_CT__). Edits go live on this box by themselves (agent/dash-live: agent restart and/or a ~15 s app rebuild a few seconds after the last save; a build error keeps the old app running, see Settings → Deploy), so never run ./deploy.sh just to apply a change. Deploy means sending the work to GitHub for everyone else (the Deploy button, agent/dash-ship): do it only when the owner asks. This conversation survives the agent and app restarting because it runs in its own systemd unit. Another Claude session may be editing the dashboard at the same time, so check `git status` and file mtimes before touching a file, and never revert work you didn't do.
The Notes tab's notes are JSON at `pct exec __DASH_CT__ -- curl -s http://127.0.0.1:3000/api/notes`. When the owner says "build my note about X", read it there first.
QUESTIONS: you have no AskUserQuestion tool here. When the owner should decide something (which approach, which option, missing details), end your answer with ONE fenced block and stop, without guessing ahead:
```questions
[{"header": "Storage", "q": "Where should the notes database live?", "multi": false,
  "options": [{"label": "CT __DASH_CT__ (Recommended)", "description": "rides along in the nightly backup"}, {"label": "local-zfs", "description": "…"}]}]
```
LINKS: link to dashboard pages with relative paths, they open inside the app: [Metrics](/metrics), a note [title](/notes?n=<id>), a chat [title](/chat?c=<id>), a tab inside a page with ?s=<tab>.
1-4 questions, 2-4 options each, a header of at most 12 characters, the recommended option first and marked "(Recommended)". "multi": true lets several be picked. The dashboard renders this as tap-to-answer buttons with a free-text "Other", and the answers arrive as the next message. Keep the prose above the block short.
ACTIONS: you cannot run host actions from here. To propose one (restart a service, backup, apt upgrade, git push, ...), do NOT run it yourself: end your answer with a fenced block and the owner gets a Run button.
```action
{"action": "service_restart", "args": {"service": "radarr"}, "why": "one short sentence"}
```
Use only action names from CATALOG in __DASHBOARD__/web/server/utils/actions.ts (Read it for the exact args); anything else is dropped. At most 3 blocks, never say it has run.
""".replace("__DASH_URL__", DASH_URL).replace("__DASHBOARD__", DASHBOARD).replace("__DASH_CT__", str(ct("dash"))).replace("__NAME__", NAME)
CC_RO = """MODE: READ-ONLY. You can read files and run read-only commands, and anything that would change state is denied automatically. Don't work around a denial. When a fix needs a change, say exactly what you would change and tell the owner to switch on **Auto** in the chat header and ask again."""
CC_PLAN_AUTO = """MODE: READ-ONLY THIS TURN, PLAN FIRST. The owner's chat has Auto on, so write access is available: this turn is plan-only only because the router chose a plan first. Never tell the owner to switch on Auto; it already is. Investigate, then give the plan as asked below, and the owner's Execute button runs it with write access."""
CC_AUTO = """MODE: AUTO. The owner switched on write access for this message. You may edit files, run commands, deploy and restart services. Nobody approves individual steps, so prefer reversible changes, don't delete data, and keep the scope to what was asked. Finish with a short list of what you changed and how to undo it."""
# --- team mode (2026-10-26, like /ship on the dev boxes): the chosen model leads and hands the reading and the typing
# to cheaper subagents, so the expensive context stays small. The lead decides by task size; a quick question it
# just answers. Read-only turns get no builder (its edits would be denied anyway).
LOCAL_SUM = f"{DASHBOARD}/agent/local-sum"
TEAM = {
    "scout": {"model": "haiku", "tools": ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"],
              "description": "Fast, cheap read-only investigator: finds files, reads code/configs/logs, runs read-only commands (pct, systemctl, journalctl, git log) and reports only the facts that answer the question. Use it for any searching or reading of more than a couple of files.",
              "prompt": f"""You are the scout of a small team working on the owner's Proxmox homelab (host {NAME}). You never change anything: no edits, no restarts, no writes. Find what the lead asked for and report back, short:
- the answer first, then the evidence as `path:line` or the exact command + the relevant output lines
- at most ~25 lines; no file dumps, no long quotes
- long logs or command output: pipe them through `{LOCAL_SUM} "<your question>"` (the local model on the 3060 reads them for free) instead of reading them yourself, then check the lines it quotes
- say plainly what you couldn't find or verify"""},
    "builder": {"model": "sonnet", "tools": ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
                "description": "Implementer: makes the code/config changes and runs the commands the lead has decided on, exactly as specified. Give it the files, the change and the done-signal.",
                "prompt": """You are the builder of a small team working on the owner's homelab. Carry out exactly the change the lead specified; don't widen the scope or refactor around it. Before editing a file, check `git status` / its mtime: another session may be editing it, never revert work you didn't do. Match the surrounding code's style and comments. Prefer reversible changes and don't delete data.
Report back in at most ~15 lines: what you changed (files), what you ran, anything that didn't go as planned, and how to undo it."""},
    "checker": {"model": "haiku", "tools": ["Read", "Bash", "Grep", "Glob"],
                "description": "Verifier: checks that a change actually works (build/deploy status, service state, curl the page or API, run tests) and reports PASS or FAIL with evidence. Never fixes.",
                "prompt": f"""You are the checker of a small team working on the owner's homelab. Verify what the lead asked you to verify; you never fix or edit anything. For dashboard changes: `cat /var/lib/dash-live/status.json` (wait until state is not "applying") and `journalctl -u dash-live -n 30`. Use `{LOCAL_SUM}` for long output.
Answer `PASS` or `FAIL` on the first line, then the evidence (command + the lines that prove it), at most ~12 lines."""},
    "reviewer": {"model": "opus", "tools": ["Read", "Grep", "Glob", "Bash"],
                 "description": "Senior reviewer for bigger changes (several files or risky logic): reads the finished diff once and reports real bugs. Read-only. Skip it for small edits.",
                 "prompt": """You are the reviewer. Read the diff you were pointed at (`git diff` in the repo) and the code around it, and report only real problems: logic errors, broken edge cases, data loss, security issues, things that won't work on a phone. Never edit. At most 8 findings, each `file:line — problem — fix`, most severe first; say "no findings" if there are none."""},
}
CC_TEAM = """TEAM MODE: you are the lead of a small team of subagents, started with the Task tool (subagent_type): `scout` (Haiku, read-only: searching, reading files and logs, read-only commands), `builder` (Sonnet: edits and commands; only when write access is on), `checker` (Haiku: verifies a change works), `reviewer` (Opus: reads a finished bigger diff once). Your tokens cost several times theirs, so you plan, delegate and decide; they read and type. Rules by task size:
- quick question, or 1-3 tool calls settle it: do it yourself, no subagents
- otherwise, any investigation (more than ~3 files to read, searching a tree, several containers/services, long logs): you MUST send scouts instead of reading yourself; one scout per independent question, all in the same message so they run in parallel (in the foreground: never run_in_background, wait for their reports); work only from their reports, re-check a single line yourself only when something doesn't add up
- a change bigger than a few lines: you decide exactly what changes; the builder edits; then a checker verifies; the reviewer only for a multi-file or risky diff
Each brief is complete and specific (the subagent knows nothing of this chat): goal, where to look, what to report back and how short. Don't redo a subagent's work. For long command output, pipe it through `__LOCAL_SUM__ "<question>"` (the local model reads it for free).
""".replace("__LOCAL_SUM__", LOCAL_SUM)
CC_PLAN = """PLAN ONLY: the owner wants a plan first. Investigate as needed, then answer with a short numbered plan of the changes you would make (files, commands, risks, how to undo). Change nothing. End with the line `PLAN READY`; the owner gets an Execute button that sends it back to you with write access."""
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


# --- auto routing (2026-10-27): a one-shot Haiku call sizes the message before the lead starts, so quick questions run
# on a small model at low effort and big jobs get a strong lead with a team. Anything the owner picked (/model,
# /effort, /team, plan) is left alone; any failure falls back to the old behaviour (Claude Code's defaults).
CC_ROUTER = """You route messages for a homelab assistant. Reply with ONE line of JSON, nothing else:
{"model": "haiku|sonnet|opus", "effort": "low|medium|high", "team": true|false}
Keep it as small as the task allows, tokens cost money but the answer must still be good.
- greeting, one fact, a status check, a short explanation: haiku, low, team false
- reading a few files or logs, a small edit, debugging one service: sonnet, medium, team false
- investigating several containers/services or a big tree, a multi-file change: sonnet (high effort at most) or opus (medium effort at most), team true
- risky, hard-to-reverse or architectural work (deletes, restores, migrations, security, big refactors): opus, medium, team true
Opus never gets high effort; the strongest allowed is opus + medium."""


def _route(prompt, auto, want_model, want_effort, want_team, want_plan):
    """-> dict with the keys the owner left open (model/effort/team/plan), {} when nothing was open or routing failed"""
    if want_model and want_effort and want_team:
        return {}
    try:
        r = subprocess.run([CLAUDE, "-p", "--model", "haiku", "--effort", "low", "--no-session-persistence", "--tools", "",
                            "--permission-mode", "dontAsk", "--system-prompt", CC_ROUTER],
                           input=f"Write access: {'on' if auto else 'off'}\nMessage:\n{prompt[:3000]}", capture_output=True, text=True,
                           timeout=25, cwd="/tmp", env={**os.environ, "HOME": "/root", "CLAUDE_PROFILE": "noven"})
        m = re.search(r"\{.*\}", r.stdout, re.S)
        d = json.loads(m[0]) if m else {}
    except (subprocess.SubprocessError, OSError, ValueError):
        return {}
    out = {}
    if not want_model and d.get("model") in ("haiku", "sonnet", "opus"):
        out["model"] = d["model"]
    if not want_effort and d.get("effort") in ("low", "medium", "high"):
        out["effort"] = d["effort"]
    if (out.get("model") or want_model) == "opus" and out.get("effort") == "high":
        out["effort"] = "medium"  # owner's cap: opus + medium is the strongest the router may pick
    if not want_team and isinstance(d.get("team"), bool):
        out["team"] = d["team"]
    # no plan from the router (2026-10-27): it flipped Auto turns into read-only plan turns ("finish the open stuff",
    # "build my note"), so Bash got denied in a chat the owner had on Auto. Plan first is only ever the owner's pick.
    return out


def claude_send(chat, session, prompt, auto, model=None, effort=None, images=None, fork=None, team=False, plan=False, quiet=False, notify=True, memory=None):
    unit = _cc_unit(chat)
    if not CC_UUID.fullmatch(session or ""):
        raise ValueError("bad session id")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 200_000:
        raise ValueError("empty or too long message")
    if model not in (None, *CC_MODELS) or effort not in (None, *CC_EFFORTS):
        raise ValueError("unknown model or effort")
    # an edited or branched chat: a new session that starts as a copy of another one up to (and with) one answer
    if fork is not None and not (isinstance(fork, dict) and CC_UUID.fullmatch(str(fork.get("from")))
                                 and CC_UUID.fullmatch(str(fork.get("at")))):
        raise ValueError("bad fork point")
    if _cc_pid(unit):
        # hand back the turn that is running so the page can show it again (its copy may wrongly say finished)
        live = [f.stem for f in CC_DIR.glob(f"{chat}-*.json") if _alive(json.loads(f.read_text()))]
        if live:
            return {"running": max(live)}
        raise ValueError("Claude is still answering in this chat — stop it first")
    CC_DIR.mkdir(mode=0o700, exist_ok=True)
    _cc_cleanup()
    routed = _route(prompt, auto, model, effort, team, plan)
    model, effort = routed.get("model", model), routed.get("effort", effort)
    team, plan = routed.get("team", team), routed.get("plan", plan)
    turn = f"{chat}-{int(time.time() * 1000)}"
    # a session Claude Code already stored is resumed, an unknown id starts one under that id
    known = any(Path("/root/.claude/projects").glob(f"*/{session}.jsonl"))
    if known:
        fork = None  # the copy was made by an earlier attempt: just carry on in it
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
    # the mode of this very message goes in front of it too: a resumed chat still holds earlier "read-only" replies, and
    # Claude was copying those over the system prompt
    if auto and not plan:
        mode = "[Mode for this message: AUTO. Write access is on. Earlier replies in this chat that say read-only are out of date.]"
    elif auto:
        mode = "[Mode for this message: PLAN FIRST. Auto is on, so write access exists; this turn only plans.]"
    else:
        mode = "[Mode for this message: READ-ONLY. Auto is off.]"
    (CC_DIR / f"{turn}.prompt").write_text(f"{mode}\n\n{prompt}")
    cmd = [CLAUDE, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
           *(["--resume", fork["from"], "--resume-session-at", fork["at"], "--fork-session", "--session-id", session] if fork
             else ["--resume" if known else "--session-id", session]), "--permission-prompts", "none",
           "--append-system-prompt", CC_SYSTEM + (CC_AUTO if auto and not plan else CC_PLAN_AUTO if auto else CC_RO) +(CC_TEAM if team else "") + (CC_PLAN if plan else "")
           + (("\n\n" + memory.strip()[:2000]) if isinstance(memory, str) and memory.strip() else ""),
           "--disallowedTools", "AskUserQuestion"]
    if team:
        agents = {k: v for k, v in TEAM.items() if auto and not plan or k != "builder"}
        (CC_DIR / "team.json").write_text(json.dumps(agents))
        cmd += ["--agents", str(CC_DIR / "team.json")]
    cmd += ["--model", model] if model else []
    cmd += ["--effort", effort] if effort else []
    if auto and not plan:
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
    (CC_DIR / f"{turn}.json").write_text(json.dumps({"chat": chat, "session": session, "auto": bool(auto), "quiet": bool(quiet), "push": bool(notify),
                                                      "pid": pid, "t0": _starttime(pid), "started": time.time()}))
    return {"turn": turn, "resumed": known, **({"routed": routed} if routed else {})}


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
    unit = _cc_unit(chat)
    # SIGKILL first: a plain stop waits up to 90 s for Claude to exit on its own
    sh("systemctl", "kill", "--signal=SIGKILL", unit)
    sh("systemctl", "stop", unit)
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


# --- a push when an answer is done or waits for the owner (topic "chat", Settings → Notifications) -----------------
# The turn runs in its own unit, so the agent looks every few seconds for ones whose process ended. The service
# worker skips it while a dashboard window is on screen. Scheduled tasks (quiet) only push when the answer doesn't
# start with ALL-OK.
def _cc_result(out):
    res = None
    try:
        with open(out, "rb") as f:
            for line in f:
                if b'"type":"result"' in line:
                    e = json.loads(line)
                    if str(e.get("result") or "").strip() or res is None:  # the last real answer (subagents may add more)
                        res = e
    except (OSError, ValueError):
        pass
    return res


def _plain(md):
    md = re.sub(r"```questions[\s\S]*?```", "", md)
    md = re.sub(r"```[\s\S]*?```", "[code]", md)
    md = re.sub(r"[*_`#>|]+", "", md)
    return re.sub(r"\s+", " ", md).strip()


def claude_watch():
    import push
    while True:
        time.sleep(5)
        cutoff = time.time() - 4 * 3600
        for meta_f in CC_DIR.glob("*-*.json"):
            try:
                if meta_f.stat().st_mtime < cutoff:
                    continue
                meta = json.loads(meta_f.read_text())
                if not meta.get("push") or meta.get("told") or _alive(meta):
                    continue
                meta["told"] = True
                meta_f.write_text(json.dumps(meta))
                res = _cc_result(CC_DIR / f"{meta_f.stem}.jsonl") or {}
                text = str(res.get("result") or "")
                if meta.get("quiet") and text.lstrip().startswith("ALL-OK"):
                    continue
                failed = res.get("is_error") or res.get("subtype") != "success"
                asks = "```questions" in text
                title = "Claude needs your answer" if asks else "Claude stopped" if failed else "Claude is done"
                body = _plain(text)[:180] or ("no answer" if failed else "")
                push.notify("chat", title, body, url=f"/chat?c={meta['chat']}")
            except Exception:  # noqa: BLE001 — one bad file must not stop the loop
                continue


def claude_task_tail(path: str, n: int = 16000) -> dict:
    """tail of a background shell's output file (Claude Code writes them to /tmp/claude-*/…/tasks/<id>.output)"""
    real = os.path.realpath(path)
    if not re.fullmatch(r"/tmp/claude-[^/]+/.+/tasks/[\w.-]+\.output", real):
        raise ValueError("not a task output file")
    try:
        with open(real, "rb") as f:
            size = f.seek(0, 2)
            f.seek(max(0, size - n))
            return {"text": f.read().decode("utf-8", "replace"), "size": size}
    except FileNotFoundError:
        return {"text": "", "size": 0}
