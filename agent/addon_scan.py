#!/usr/bin/env python3
"""addon_scan — a safety check of add-on code before it runs as root on pve.

  addon_scan.py <dir> [--id <id>] [--old <installed dir>] [--repo] [--json]    exit 0 = nothing blocking, 2 = blocked
  (--repo: a backend repo, not an add-on folder, so no layout check)

Add-ons are source (Python, shell, Vue/TS), so the danger is less a classic virus than a script that does
something nasty: a reverse shell, a miner, decode-and-run, an ssh key planted for root, the dashboard's own
secrets read and sent away. The rules below look for those; `block` stops addon-get and backend-install,
`warn` and `info` are shown on the confirm card and in the job log for the owner to judge.
When ClamAV is installed (`clamscan`), its signatures run too and any hit blocks.
An owner-side allowlist, config.json marketplace.scan_allow = ["<id>:<rule>"], silences a rule for one add-on
(never read from the add-on itself, so an add-on can't wave itself through).
"""
import hashlib, json, os, re, shutil, subprocess, sys
from pathlib import Path

TEXT_EXT = {".py", ".sh", ".bash", ".js", ".mjs", ".cjs", ".ts", ".vue", ".json", ".yaml", ".yml", ".toml",
            ".cfg", ".ini", ".conf", ".service", ".timer", ".txt", ".md", ".html", ".css", ".sql", ".env", ""}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".nuxt", ".output", ".venv", "venv"}
LAYOUT = {"addon.yaml", "web", "agent", "install.sh", "deploy.sh", "scripts", "README.md", "CLAUDE.md", "LICENSE", "assets"}
BIN_MAGIC = {b"\x7fELF": "Linux executable (ELF)", b"MZ": "Windows executable", b"\xcf\xfa\xed\xfe": "macOS executable",
             b"\xca\xfe\xba\xbe": "macOS/Java binary", b"\x00asm": "WebAssembly module"}
ARCHIVES = (".zip", ".tar", ".tgz", ".gz", ".xz", ".bz2", ".7z", ".rar", ".jar", ".whl", ".deb", ".so", ".exe", ".dll", ".bin", ".pyc")

# (rule, level, what it means, regex) — run per line over text files
RULES = [
    ("reverse-shell", "block", "opens a shell to a remote host",
     r"/dev/tcp/|\bn(?:c|cat)\b[^\n|;]*\s-[a-z]*e\s|socat\b[^\n]*exec:|bash -i\s*>&|pty\.spawn\(|0<&\d+;\s*exec"),
    ("miner", "block", "cryptocurrency miner",
     r"(?i)xmrig|stratum\+(?:tcp|ssl)://|cryptonight|\bminerd\b|coinhive|nicehash|monero(?:ocean|hash)|randomx"),
    ("decode-exec", "block", "decodes hidden code and runs it",
     r"(?i)base64\s+(?:-d|--decode)[^\n]*\|\s*(?:ba|z|da)?sh\b|eval\s*\(\s*(?:atob|base64|b64decode|codecs\.decode|zlib\.decompress|bytes\.fromhex)"
     r"|exec\s*\(\s*(?:base64|__import__\(['\"]base64|zlib|codecs|bytes\.fromhex|marshal)|new Function\s*\(\s*atob|marshal\.loads"),
    ("ssh-key", "block", "plants an ssh key or touches ssh config",
     r"authorized_keys|/etc/ssh/sshd_config|\.ssh/id_(?:rsa|ed25519|ecdsa)"),
    ("system-auth", "block", "edits system logins or sudo",
     r"/etc/shadow|/etc/sudoers|/etc/passwd\b[^\n]*>|\bchpasswd\b|\busermod\b[^\n]*-p|\bpasswd\s+root"),
    ("setuid", "block", "makes a file setuid",
     r"chmod\s+(?:[ugo]*\+s|[2-7][0-7]{3})\b"),
    ("cover-tracks", "block", "wipes shell history or logs",
     r"history\s+-c|unset\s+HISTFILE|HISTFILE=/dev/null|(?:shred|truncate)[^\n]*/var/log|>\s*/var/log/(?:auth|syslog|wtmp|btmp)|journalctl\s+--vacuum"),
    ("disable-security", "block", "turns off a firewall or protection",
     r"setenforce\s+0|iptables\s+-F|ufw\s+disable|pve-firewall\s+stop|aa-teardown|systemctl\s+(?:stop|disable|mask)\s+(?:pve-firewall|apparmor|fail2ban)"),
    ("wipe", "block", "deletes the whole system",
     r"rm\s+-[a-z]*r[a-z]*f?\s+(?:--no-preserve-root|/\s|/\*|/$|~/?\s*$|\"\$HOME\"\s*$)|mkfs\.|dd\s+if=[^\n]*of=/dev/(?:sd|nvme|zd)|zpool\s+destroy|zfs\s+destroy\s+-r"),
    ("dash-secret", "block", "reads a secret that belongs to the dashboard itself, not to this add-on",
     r"agent/token\b|\bpin_hash\b|\blan_key\b|/etc/dash/secrets/|/root/\.claude|\.credentials\.json|/etc/pve/priv"),
    ("pipe-to-shell", "warn", "downloads a script and runs it unseen",
     r"(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|(?:ba)?sh\s+<\(\s*(?:curl|wget)"),
    ("raw-ip", "warn", "talks to a bare IP address on the internet",
     r"https?://(?!(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.)\d{1,3}(?:\.\d{1,3}){3}"),
    ("github-token", "warn", "reads the GitHub token (fine for Dev-style add-ons, odd for others)",
     r"github_token|GH_TOKEN|GITHUB_TOKEN"),
    ("dyn-exec", "warn", "runs code built at runtime",
     r"(?<![\w.])eval\s*\(|(?<![\w.])exec\s*\(\s*(?!['\"])|__import__\s*\(|new Function\s*\("),
    ("persistence", "info", "installs a service, timer or cron job",
     r"systemctl\s+enable|/etc/systemd/system/|crontab\s|/etc/cron\.|/etc/rc\.local"),
    ("host-ct", "info", "creates or changes containers",
     r"\bpct\s+(?:create|set|destroy)|\bqm\s+(?:create|set|destroy)|backend-install"),
]
RULES = [(r, lvl, why, re.compile(rx)) for r, lvl, why, rx in RULES]
URL_RE = re.compile(r"https?://([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})")
LONG_B64 = re.compile(r"[A-Za-z0-9+/=]{400,}")
LOCAL_HOSTS = re.compile(r"(?:^|\.)(?:ts\.net|local|lan|localhost|example\.(?:com|org)|fritz\.box)$")


def _sha(p: Path):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def files(root: Path):
    for dp, dns, fns in os.walk(root, followlinks=False):
        dns[:] = sorted(d for d in dns if d not in SKIP_DIRS or d == "node_modules")
        for fn in sorted(fns):
            yield Path(dp) / fn
        for d in dns:
            if (Path(dp) / d).is_symlink():
                yield Path(dp) / d


def scan(root, old=None, aid=None, allow=(), layout=True):
    root, out, domains, changed = Path(root), [], set(), []
    allow = set(allow)

    def add(level, rule, why, f=None, line=None, text=None):
        if f"{aid}:{rule}" in allow and level != "block-hard":
            return
        out.append({"level": "block" if level == "block-hard" else level, "rule": rule, "why": why,
                    "file": str(f.relative_to(root)) if f else None, "line": line, "text": (text or "").strip()[:160] or None})

    if layout:
        for p in sorted(root.iterdir()):
            if p.name not in LAYOUT and not p.name.startswith(".git"):
                add("warn", "layout", "a file outside the usual add-on layout", p)
    for f in files(root):
        rel = f.relative_to(root)
        if "node_modules" in rel.parts:
            add("warn", "vendored", "ships its own node_modules (code nobody reviewed)", f)
            continue
        if f.is_symlink():
            t = os.path.realpath(f)
            if not t.startswith(str(root.resolve()) + os.sep):
                add("block-hard", "symlink-out", f"links outside the add-on (→ {t})", f)
            continue
        if not f.is_file():
            continue
        size = f.stat().st_size
        head = f.open("rb").read(4)
        kind = next((k for m, k in BIN_MAGIC.items() if head.startswith(m)), None)
        if kind:
            add("block-hard", "binary", f"{kind}: compiled code that can't be read", f)
            continue
        if f.name.lower().endswith(ARCHIVES):
            add("warn", "archive", "packed or compiled file, its contents aren't checked", f)
            continue
        if f.suffix.lower() not in TEXT_EXT and f.name not in ("Dockerfile", "Makefile"):
            continue
        if size > 2_000_000:
            add("warn", "big-file", f"{size // 1_000_000} MB text file, too big to read", f)
            continue
        try:
            text = f.read_text(errors="replace")
        except OSError:
            continue
        if f.name == "package.json":
            try:
                scripts = (json.loads(text).get("scripts") or {})
                for k in ("preinstall", "install", "postinstall", "prepare"):
                    if k in scripts:
                        add("warn", "npm-hook", f"npm runs `{k}` on install: {scripts[k]}", f)
            except (ValueError, AttributeError):
                pass
        for n, line in enumerate(text.splitlines(), 1):
            if len(line) > 2000 and f.suffix in (".js", ".ts", ".py", ".sh", ".vue", ".mjs", ".cjs"):
                add("warn", "minified", "a very long line (minified or obfuscated code)", f, n, line[:80])
                continue
            if LONG_B64.search(line) and f.suffix not in (".json", ".css", ".svg", ".md"):
                add("warn", "blob", "a long encoded blob inside code", f, n, line[:80])
            for rule, lvl, why, rx in RULES:
                own = line.replace(f"/etc/dash/secrets/{aid}.json", "") if aid else line  # its own secrets are fine
                if rx.search(own if rule == "dash-secret" else line):
                    add(lvl, rule, why, f, n, line)
            domains.update(d.lower() for d in URL_RE.findall(line))
    if old and Path(old).is_dir():
        old = Path(old)
        new_set = {p.relative_to(root) for p in files(root) if p.is_file()}
        old_set = {p.relative_to(old) for p in files(old) if p.is_file()}
        changed = sorted([f"+ {p}" for p in new_set - old_set] + [f"- {p}" for p in old_set - new_set]
                         + [f"~ {p}" for p in new_set & old_set if _sha(root / p) != _sha(old / p)])
    clam = clamav(root)
    for f, sig in clam.get("hits", []):
        out.append({"level": "block", "rule": "clamav", "why": f"ClamAV: {sig}", "file": f, "line": None, "text": None})
    ext = sorted(d for d in domains if not LOCAL_HOSTS.search(d))
    order = {"block": 0, "warn": 1, "info": 2}
    out.sort(key=lambda x: (order[x["level"]], x["file"] or "", x["line"] or 0))
    count = {k: sum(1 for x in out if x["level"] == k) for k in order}
    return {"ok": not count["block"], "count": count, "findings": out, "domains": ext, "changed": changed,
            "clamav": clam.get("state")}


def clamav(root: Path):
    exe = shutil.which("clamdscan") or shutil.which("clamscan")
    if not exe:
        return {"state": "not installed"}
    args = [exe, "--infected", "--no-summary"] + (["--fdpass"] if exe.endswith("clamdscan") else ["-r"]) + [str(root)]
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"state": f"failed ({e.__class__.__name__})"}
    hits = []
    for line in r.stdout.splitlines():
        p, _, sig = line.rpartition(": ")
        if sig.endswith(" FOUND"):
            hits.append((os.path.relpath(p, root), sig[:-6]))
    return {"state": "clean" if r.returncode == 0 else ("infected" if r.returncode == 1 else f"error {r.returncode}"), "hits": hits}


def summary(rep):
    c = rep["count"]
    s = f"safety check: {c['block']} blocking, {c['warn']} warnings, {c['info']} notes (ClamAV: {rep['clamav']})"
    lines = [s]
    for x in rep["findings"]:
        at = f"{x['file']}:{x['line']}" if x["line"] else (x["file"] or "")
        lines.append(f"  [{x['level']}] {x['rule']} {at} — {x['why']}" + (f"\n      {x['text']}" if x["text"] else ""))
    if rep["domains"]:
        lines.append("  talks to: " + ", ".join(rep["domains"][:30]))
    if rep["changed"]:
        lines.append(f"  {len(rep['changed'])} files changed: " + ", ".join(rep["changed"][:40]))
    return "\n".join(lines)


def main():
    a = sys.argv[1:]
    if not a or a[0].startswith("-"):
        sys.exit(__doc__)
    old = a[a.index("--old") + 1] if "--old" in a else None
    aid = a[a.index("--id") + 1] if "--id" in a else None
    try:
        allow = (json.loads(Path("/etc/dash/config.json").read_text()).get("marketplace") or {}).get("scan_allow") or []
    except (OSError, ValueError):
        allow = []
    rep = scan(a[0], old, aid, allow, layout="--repo" not in a)
    print(json.dumps(rep, indent=1) if "--json" in a else summary(rep))
    sys.exit(0 if rep["ok"] else 2)


if __name__ == "__main__":
    main()
