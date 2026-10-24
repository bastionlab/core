"""Learn tab: Claude writes a lesson on the host, one transient systemd unit per lesson

The dashboard (CT 104) owns the library and the prompt; this only runs a tool-less `claude -p` with a JSON schema
and hands back the structured answer. The unit writes to a file, so a lesson keeps being written through an agent
restart, and the dashboard just asks again until it is done.
"""
import json, re, subprocess, time
from pathlib import Path

from dash_sdk import CLAUDE, alive, get, post, starttime, unit_pid

DIR = Path("/var/lib/dash-learn")
KEEP_DAYS = 14
MODELS = ("sonnet", "opus", "haiku")


def _job(job):
    if not re.fullmatch(r"[a-z0-9]{4,24}", job or ""):
        raise ValueError("bad job id")
    return f"dash-learn-{job}"


@post("/learn/start")
def start(body):
    return learn_start(str(body.get("job")), body.get("prompt"), body.get("schema"), str(body.get("model") or "sonnet"))


def learn_start(job, prompt, schema, model="sonnet"):
    unit = _job(job)
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 100_000:
        raise ValueError("empty or too long prompt")
    if not isinstance(schema, dict) or model not in MODELS:
        raise ValueError("bad schema or model")
    if unit_pid(unit):
        return {"job": job, "running": True}
    DIR.mkdir(mode=0o700, exist_ok=True)
    cutoff = time.time() - KEEP_DAYS * 86400
    for f in DIR.glob("*"):
        if f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)
    (DIR / f"{job}.prompt").write_text(prompt)
    (DIR / f"{job}.out").unlink(missing_ok=True)
    # no tools at all: it only writes text, so nothing it says can touch the host
    cmd = [CLAUDE, "-p", "--model", model, "--effort", "medium", "--no-session-persistence", "--tools", "",
           "--output-format", "json", "--json-schema", json.dumps(schema)]
    r = subprocess.run(["systemd-run", "--unit", unit, "--collect", "--quiet", "-p", "WorkingDirectory=/tmp",
                        "-p", f"StandardInput=file:{DIR / f'{job}.prompt'}",
                        "-p", f"StandardOutput=file:{DIR / f'{job}.out'}", "-p", f"StandardError=file:{DIR / f'{job}.err'}",
                        "-p", "RuntimeMaxSec=40min",
                        "-E", "HOME=/root", "-E", "CLAUDE_PROFILE=noven", "-E", "TERM=dumb",
                        "-E", "PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                        *cmd], capture_output=True, text=True, timeout=20)
    if r.returncode:
        raise ValueError(f"could not start claude: {r.stderr.strip()[:300]}")
    pid = unit_pid(unit)
    (DIR / f"{job}.json").write_text(json.dumps({"pid": pid, "t0": starttime(pid), "started": time.time()}))
    return {"job": job, "running": True}


@get("/learn/job", quiet=True)
def job_route(q):
    return learn_job(q["id"])


def learn_job(job):
    _job(job)
    meta = DIR / f"{job}.json"
    if not meta.exists():
        return {"state": "gone"}
    m = json.loads(meta.read_text())
    if alive(m):
        return {"state": "running", "secs": int(time.time() - m["started"])}
    out, err = DIR / f"{job}.out", DIR / f"{job}.err"
    try:
        r = json.loads(out.read_text())
    except (OSError, ValueError):
        tail = err.read_text(errors="replace")[-400:] if err.exists() else ""
        return {"state": "failed", "error": tail.strip() or "claude stopped without an answer"}
    if r.get("is_error") or not isinstance(r.get("structured_output"), dict):
        return {"state": "failed", "error": str(r.get("result") or r.get("subtype") or "no structured answer")[:400]}
    return {"state": "done", "result": r["structured_output"], "secs": int(r.get("duration_ms", 0) / 1000)}
