"""the owner's GitHub repos for the Dev page"""
import re

from core import GH_TOKEN_FILE, GH_USER, GH_USER_FILE, cached, http_json


def _gh_user():
    """the GitHub account this server belongs to — override by writing a name into keys/github_user"""
    if GH_USER_FILE.exists():
        name = GH_USER_FILE.read_text().strip()
        if re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})", name):
            return name
    return GH_USER


def _gh_repo(r):
    return {"name": r["name"], "full": r["full_name"], "owner": r["owner"]["login"], "ssh": r["ssh_url"],
            "url": r["html_url"], "private": r["private"], "fork": r.get("fork", False),
            "archived": r.get("archived", False), "lang": r.get("language"), "stars": r.get("stargazers_count", 0),
            "branch": r.get("default_branch"), "pushed": r.get("pushed_at"),
            "desc": (r.get("description") or "")[:140]}


@cached(120)
def github_repos():
    """the owner's repos, for the project picker. With a token in keys/github_token this is every repo
    (private included); without one we still list the public repos of keys/github_user (GH_USER)."""
    user = _gh_user()
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "pve-dashboard"}
    token = GH_TOKEN_FILE.read_text().strip() if GH_TOKEN_FILE.exists() else ""
    if token:
        url = "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator"
        headers["Authorization"] = f"Bearer {token}"
    else:
        url = f"https://api.github.com/users/{user}/repos?per_page=100&sort=pushed"
    out = {"configured": bool(token), "user": user, "url": f"https://github.com/{user}?tab=repositories",
           "scope": "all repos incl. private" if token else "public repos only",
           "repos": []}
    if not token:
        out["hint"] = ("listing public repos of " + user + " — put a GitHub token (repo scope) in "
                       "/root/devbox/keys/github_token to see private ones too")
    try:
        data = http_json(url, headers, timeout=25) or []
        out["repos"] = [_gh_repo(r) for r in data]
    except Exception as e:
        out["error"] = str(e)[:200]
    return out
