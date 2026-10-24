"""the media stack in CT 106 (*arr, qBittorrent behind the VPN, LazyLibrarian): queues, library, removal"""
import json, re, time, urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urlencode

from config import DASHBOARD, ct, ip
from core import FAN, POOL, cached, http_json, invalidate, js, sh


# --- media stack (CT 106 "dl") ----------------------------------------------
MEDIA_CT = ct("dl")
MEDIA_IP = ip("dl")
MEDIA_ROOT = Path("/tank/medien")
# app -> (port, api version)
ARR = {"radarr": (7878, "v3"), "sonarr": (8989, "v3"), "prowlarr": (9696, "v1")}
QB = (8080, "admin")
LL_PORT = 5299


@cached(1800)
def media_keys():
    """API keys stay on the host: read out of CT 106's configs, never sent to the dashboard"""
    keys = {}
    for app in ("radarr", "sonarr", "prowlarr"):
        m = re.search(r"<ApiKey>([^<]+)</ApiKey>",
                      sh("pct", "exec", str(MEDIA_CT), "--", "cat", f"/opt/media/{app}/config.xml", timeout=15))
        if m:
            keys[app] = m[1]
    m = re.search(r"^api_key\s*=\s*(\S+)", sh("pct", "exec", str(MEDIA_CT), "--", "cat",
                                                "/opt/media/lazylibrarian/config.ini", timeout=15), re.M)
    if m:
        keys["lazylibrarian"] = m[1]
    pw = sh("pct", "exec", str(MEDIA_CT), "--", "cat", "/opt/media/.qb-password", timeout=15).strip()
    if pw:
        keys["qb"] = pw
    return keys


def arr(app, path, **query):
    port, ver = ARR[app]
    key = media_keys().get(app)
    if not key:
        raise ValueError(f"no API key for {app}")
    url = f"http://{MEDIA_IP}:{port}/api/{ver}/{path}"
    if query:
        url += "?" + urlencode(query)
    return http_json(url, {"X-Api-Key": key}, timeout=25)


def lazylibrarian(cmd, **query):
    key = media_keys().get("lazylibrarian")
    if not key:
        raise ValueError("no API key for lazylibrarian")
    return http_json(f"http://{MEDIA_IP}:{LL_PORT}/api?" + urlencode({"apikey": key, "cmd": cmd, **query}), timeout=25)


_qb_sid = [None, 0.0]


def qb(path, **query):
    """qBittorrent WebUI API — one cookie is reused until it stops working"""
    port, user = QB
    base = f"http://{MEDIA_IP}:{port}/api/v2/"
    for attempt in (0, 1):
        if not _qb_sid[0] or time.time() - _qb_sid[1] > 1800 or attempt:
            body = urlencode({"username": user, "password": media_keys().get("qb", "")}).encode()
            req = urllib.request.Request(base + "auth/login", data=body,
                                         headers={"Referer": f"http://{MEDIA_IP}:{port}"})
            with urllib.request.urlopen(req, timeout=15) as r:
                cookie = r.headers.get("Set-Cookie", "")
            sid = re.search(r"(?:QBT_SID_\d+|SID)=[^;]+", cookie)  # the cookie is named after the WebUI port
            if not sid:
                raise ValueError("qBittorrent login failed")
            _qb_sid[0], _qb_sid[1] = sid[0], time.time()
        try:
            return http_json(base + path + ("?" + urlencode(query) if query else ""),
                             {"Cookie": _qb_sid[0]}, timeout=20)
        except urllib.error.HTTPError as e:
            if e.code != 403 or attempt:
                raise
    return None


@cached(600)
def wan_ip():
    """the household's own public IP — what the VPN must NOT be showing"""
    return sh("curl", "-s", "-m", "8", "https://ipinfo.io/ip", timeout=12).strip() or None


@cached(300)
def vpn_where():
    out = sh("pct", "exec", str(MEDIA_CT), "--", "docker", "exec", "gluetun",
             "wget", "-qO-", "-T", "8", "https://ipinfo.io/json", timeout=25)
    try:
        return json.loads(out)
    except Exception:
        return {}


@cached(20)
def vpn():
    """is the tunnel up, is it actually hiding us, and is the kill switch armed"""
    inspect = js("pct", "exec", str(MEDIA_CT), "--", "docker", "inspect", "gluetun", "--format",
                 "{{json .State}}", timeout=20, default={}) or {}
    rules = sh("pct", "exec", str(MEDIA_CT), "--", "docker", "exec", "gluetun",
               "iptables", "-S", "OUTPUT", timeout=20)
    port = sh("pct", "exec", str(MEDIA_CT), "--", "docker", "exec", "gluetun",
              "cat", "/tmp/gluetun/forwarded_port", timeout=20).strip()
    info, vpn_ip, listen, transfer = vpn_where(), None, None, None
    try:
        transfer = qb("transfer/info")
        vpn_ip = (transfer or {}).get("last_external_address_v4") or None
        listen = (qb("app/preferences") or {}).get("listen_port")
    except Exception:
        pass
    vpn_ip = vpn_ip or info.get("ip")
    home = wan_ip()
    return {
        "up": inspect.get("Running") and (inspect.get("Health") or {}).get("Status") != "unhealthy",
        "health": (inspect.get("Health") or {}).get("Status"),
        "since": inspect.get("StartedAt"),
        "killSwitch": "-P OUTPUT DROP" in rules,
        "ip": vpn_ip,
        "homeIp": home,
        "leaking": bool(vpn_ip and home and vpn_ip == home),
        "country": info.get("country"), "city": info.get("city"), "org": info.get("org"),
        "forwardedPort": int(port) if port.isdigit() else None,
        "listenPort": listen,
        "portOk": bool(port.isdigit() and listen and int(port) == listen),
        "speed": {"down": (transfer or {}).get("dl_info_speed"), "up": (transfer or {}).get("up_info_speed"),
                  "downTotal": (transfer or {}).get("dl_info_data"), "upTotal": (transfer or {}).get("up_info_data"),
                  "status": (transfer or {}).get("connection_status")} if transfer else None,
    }


def queue_items(kind, records, torrents):
    out = []
    for r in records or []:
        t = torrents.get(str(r.get("downloadId", "")).lower(), {})
        size, left = r.get("size") or 0, r.get("sizeleft") or 0
        title = (r.get("movie") or {}).get("title") or (r.get("series") or {}).get("title") \
            or (r.get("album") or {}).get("title") or r.get("title")
        ep = r.get("episode") or {}
        sub = f"S{ep['seasonNumber']:02d}E{ep['episodeNumber']:02d} · {ep.get('title', '')}" if ep.get("episodeNumber") \
            else (r.get("artist") or {}).get("artistName") or r.get("quality", {}).get("quality", {}).get("name")
        out.append({
            "kind": kind, "id": r.get("id"), "title": title, "sub": sub, "release": r.get("title"),
            # a season pack is one torrent behind one queue row per episode
            "hash": str(r.get("downloadId", "")).lower() or None,
            "status": r.get("status"), "state": r.get("trackedDownloadState"), "client": r.get("downloadClient"),
            "size": size, "left": left, "progress": round(100 * (size - left) / size, 1) if size else 0,
            "eta": r.get("timeleft"), "speed": t.get("dlspeed"), "seeds": t.get("num_seeds"),
            # how long since any byte arrived - the difference between slow and dead
            "idleHours": round((time.time() - t["last_activity"]) / 3600, 1)
                         if t.get("last_activity") else None,
            "ratio": round(t.get("ratio", 0), 2) if t.get("ratio") is not None else None,
            "torrentState": t.get("state"),
            "messages": [m.get("messages", [m.get("title")])[0] for m in (r.get("statusMessages") or [])][:3],
            "error": r.get("errorMessage"),
        })
    return out


# a finished torrent stays in qBittorrent to seed; the *arr queues drop an item
# at import, so these have to be filtered out by hand or books never leave the list
SEEDING_STATES = {"uploading", "stalledUP", "queuedUP", "pausedUP", "stoppedUP",
                  "forcedUP", "checkingUP"}


def bare_torrents(torrents, category, kind):
    """downloads with no *arr queue behind them (LazyLibrarian works this way)"""
    return [{
        "kind": kind, "id": h[:8], "hash": h, "title": t.get("name"), "sub": t.get("category"), "release": t.get("name"),
        "status": t.get("state"), "state": None, "client": "qBittorrent",
        "size": t.get("size"), "left": t.get("amount_left"), "progress": round(100 * t.get("progress", 0), 1),
        "eta": None, "speed": t.get("dlspeed"), "seeds": t.get("num_seeds"),
        "ratio": round(t.get("ratio", 0), 2), "torrentState": t.get("state"), "messages": [], "error": None,
    } for h, t in torrents.items()
        if t.get("category") == category and t.get("state") not in SEEDING_STATES]


@cached(300)
def media_sizes():
    """bytes per media directory (ZFS keeps this in ARC, so it is cheap) + what hardlinks save"""
    dirs = [d for d in sorted(MEDIA_ROOT.iterdir()) if d.is_dir()] if MEDIA_ROOT.is_dir() else []
    out = {}
    for d in dirs:
        r = sh("du", "-sb", str(d), timeout=120).split("\t")
        if r and r[0].isdigit():
            out[d.name] = int(r[0])
    used = None
    for line in sh("zfs", "list", "-Hp", "-o", "name,used,avail", "tank/medien").splitlines():
        _, u, avail = line.split("\t")
        used = {"used": int(u), "avail": int(avail)}
    return {"dirs": out, "apparent": sum(out.values()), **(used or {})}


def library():
    def movies():
        m = arr("radarr", "movie") or []
        return {"total": len(m), "have": sum(1 for x in m if x.get("hasFile")),
                "size": sum(x.get("sizeOnDisk") or 0 for x in m),
                "monitored": sum(1 for x in m if x.get("monitored"))}

    def series():
        s = arr("sonarr", "series") or []
        groups = {}
        for x in s:
            key = "anime" if "/anime" in (x.get("rootFolderPath") or "") else "serien"
            st = x.get("statistics") or {}
            g = groups.setdefault(key, {"total": 0, "episodes": 0, "missing": 0, "size": 0})
            g["total"] += 1
            g["episodes"] += st.get("episodeFileCount") or 0
            g["missing"] += max(0, (st.get("episodeCount") or 0) - (st.get("episodeFileCount") or 0))
            g["size"] += st.get("sizeOnDisk") or 0
        return groups

    def books():
        b = lazylibrarian("getAllBooks") or []
        b = b if isinstance(b, list) else []
        return {"total": len(b), "have": sum(1 for x in b if str(x.get("Status", "")).lower() == "open"),
                "wanted": len(lazylibrarian("getWanted") or [])}

    parts = {"movies": FAN.submit(movies), "series": FAN.submit(series),
             "books": FAN.submit(books)}
    out = {}
    for k, f in parts.items():
        try:
            out[k] = f.result(timeout=40)
        except Exception as e:
            out[k] = {"error": str(e)[:200]}
    if isinstance(out.get("series"), dict) and "error" not in out["series"]:
        out["anime"] = out["series"].pop("anime", {"total": 0, "episodes": 0, "missing": 0, "size": 0})
        out["series"] = out["series"].pop("serien", {"total": 0, "episodes": 0, "missing": 0, "size": 0})
    return out


@cached(20)
def watchdog():
    """qb-watchdog.py in CT 106 leaves its last verdict in a file; this is the only
    channel it has, so a missing or stale file is itself worth showing."""
    raw = sh("pct", "exec", str(MEDIA_CT), "--", "cat",
             "/opt/media/qbittorrent/watchdog-report.json", timeout=15)
    try:
        report = json.loads(raw)
    except Exception:
        return None
    report["age"] = max(0, int(time.time()) - int(report.get("ts") or 0))
    return report


@cached(15)
def media():
    torrents, qb_error = {}, None
    try:
        torrents = {t["hash"].lower(): t for t in (qb("torrents/info") or [])}
    except Exception as e:
        # without this the queue still lists every row but with no speeds, and the page claims nothing is moving
        qb_error = str(e)[:200] or type(e).__name__

    def q(app, kind, **extra):
        try:
            r = arr(app, "queue", pageSize=1000, **extra)
            return queue_items(kind, (r or {}).get("records"), torrents)
        except Exception as e:
            return [{"kind": kind, "error": str(e)[:200], "title": f"{app} queue unavailable"}]

    parts = {
        "vpn": POOL.submit(vpn),
        "library": POOL.submit(library),
        "sizes": POOL.submit(media_sizes),
        "watchdog": POOL.submit(watchdog),
        "movies": POOL.submit(q, "radarr", "movies", includeMovie="true"),
        "series": POOL.submit(q, "sonarr", "series", includeSeries="true", includeEpisode="true"),
    }
    res = {}
    for k, f in parts.items():
        try:
            res[k] = f.result(timeout=60)
        except Exception as e:
            res[k] = {"error": str(e)[:200]}
    queues = {"movies": res["movies"], "series": res["series"],
              "books": bare_torrents(torrents, "lazylibrarian", "books")}
    active = [t for t in torrents.values() if t.get("dlspeed") or t.get("state") in ("downloading", "stalledDL", "metaDL")]
    return {"time": int(time.time()), "vpn": res["vpn"], "library": res["library"], "sizes": res["sizes"],
            "queues": queues, "watchdog": res["watchdog"],
            "torrents": {"error": qb_error, "total": len(torrents), "downloading": len(active),
                         "seeding": sum(1 for t in torrents.values() if t.get("state", "").endswith(("UP", "uploading"))),
                         "errored": [t["name"][:80] for t in torrents.values() if "error" in t.get("state", "").lower()][:5]}}


@cached(60)
def media_items():
    """everything the library holds, for the Remove picker — one row per series or film"""
    out = []
    for s in arr("sonarr", "series") or []:
        st = s.get("statistics") or {}
        out.append({"kind": "series", "id": s["id"], "title": s["title"], "year": s.get("year"),
                    "group": "anime" if "/anime" in (s.get("rootFolderPath") or s.get("path") or "") else "series",
                    "path": s.get("path"), "size": st.get("sizeOnDisk") or 0, "files": st.get("episodeFileCount") or 0,
                    "seasons": [{"n": se["seasonNumber"], "monitored": se.get("monitored", False),
                                 "files": (se.get("statistics") or {}).get("episodeFileCount") or 0,
                                 "size": (se.get("statistics") or {}).get("sizeOnDisk") or 0}
                                for se in s.get("seasons") or []]})
    for m in arr("radarr", "movie") or []:
        out.append({"kind": "movie", "id": m["id"], "title": m["title"], "year": m.get("year"), "group": "movie",
                    "path": m.get("path"), "size": m.get("sizeOnDisk") or 0, "files": 1 if m.get("hasFile") else 0})
    return sorted(out, key=lambda x: (x["title"].lower(), x["year"] or 0))


def _seasons(seasons):
    """"1,2" / [1, 2] -> [1, 2]; None or empty -> None (the whole item)"""
    if seasons in (None, "", []):
        return None
    try:
        out = sorted({int(x) for x in (seasons.split(",") if isinstance(seasons, str) else seasons)})
    except (TypeError, ValueError):
        raise ValueError("seasons must be numbers")
    return out or None


def media_plan(kind, item_id, seasons=None):
    """what removing one series/film touches: the *arr entry with its files, and every torrent in qBittorrent
    that its history says it grabbed or imported from. The library files and the seeding copies are hardlinks
    of the same bytes, so the space only comes back once both are gone.

    With seasons (series only) the entry stays: only those seasons' episode files go, the seasons are
    unmonitored so Sonarr does not fetch them again, and the series keeps monitoring new episodes. Only
    torrents whose every episode lies in those seasons are removed — a pack that also covers a kept season
    stays (it would only stop seeding; the kept library files are separate hardlinks either way)."""
    if kind not in ("series", "movie"):
        raise ValueError("kind must be series or movie")
    try:
        item_id = int(item_id)
    except (TypeError, ValueError):
        raise ValueError("id must be a number")
    seasons = _seasons(seasons)
    if seasons and kind != "series":
        raise ValueError("only series have seasons")
    item = next((x for x in media_items() if x["kind"] == kind and x["id"] == item_id), None)
    if not item:
        invalidate("media_items")
        item = next((x for x in media_items() if x["kind"] == kind and x["id"] == item_id), None)
    if not item:
        raise ValueError(f"no {kind} with id {item_id} in {'Sonarr' if kind == 'series' else 'Radarr'}")
    app, hist = ("sonarr", arr("sonarr", "history/series", seriesId=item_id)) if kind == "series" \
        else ("radarr", arr("radarr", "history/movie", movieId=item_id))
    torrents = {t["hash"].lower(): t for t in (qb("torrents/info") or [])}

    def held(hs):
        return [{"hash": h, "name": torrents[h]["name"], "size": torrents[h].get("size") or 0,
                 "state": torrents[h].get("state")} for h in sorted(hs) if h in torrents]

    if not seasons:
        hashes = {str(r["downloadId"]).lower() for r in hist or [] if r.get("downloadId")}
        t = held(hashes)
        return {**item, "app": app, "seasons": None, "torrents": t, "torrentSize": sum(x["size"] for x in t)}

    known = {se["n"]: se for se in item["seasons"]}
    if missing := [n for n in seasons if n not in known]:
        raise ValueError(f"{item['title']} has no season {', '.join(map(str, missing))}")
    ep_season = {e["id"]: e["seasonNumber"] for e in arr("sonarr", "episode", seriesId=item_id) or []}
    by_hash = {}
    for r in hist or []:
        if r.get("downloadId"):
            by_hash.setdefault(str(r["downloadId"]).lower(), set()).add(ep_season.get(r.get("episodeId")))
    only = {h for h, ss in by_hash.items() if ss and ss <= set(seasons)}
    shared = {h for h, ss in by_hash.items() if h not in only and ss & set(seasons)}
    t = held(only)
    return {**item, "app": app, "seasons": seasons,
            "files": sum(known[n]["files"] for n in seasons), "size": sum(known[n]["size"] for n in seasons),
            "latest": max((n for n in known if n > 0), default=None),
            "torrents": t, "torrentSize": sum(x["size"] for x in t), "shared": held(shared)}


def _gb(n):
    return f"{n / 2**30:.1f} GB" if n >= 2**30 else f"{n / 2**20:.0f} MB"


MEDIA_RM = f"{DASHBOARD}/agent/media-rm"


def a_media_remove(args):
    """Destructive and final — unlike project_remove there is no trash. Only the Media page's Remove panel
    offers it (behind two confirmations); it is deliberately not in the Ask bar's action catalog.
    With seasons it removes only those seasons of a series and keeps the series (and its new episodes)."""
    p = media_plan(str(args.get("kind", "")), args.get("id"), args.get("seasons"))
    what = f"{p['title']}" + (f" ({p['year']})" if p.get("year") else "")
    files = f"{p['files']} episode file(s)" if p["kind"] == "series" else ("the film file" if p["files"] else "no file on disk")
    tor = f", and {len(p['torrents'])} torrent(s) in qBittorrent with their data" if p["torrents"] else ""
    hashes = [t["hash"] for t in p["torrents"]]
    if p["seasons"]:
        ss = ", ".join(map(str, p["seasons"]))
        desc = (f"DELETE season {ss} of {what} for good: {files} ({_gb(p['size'])}){tor}. "
                f"Those seasons are unmonitored; the series stays in Sonarr and keeps getting new episodes")
        return desc, ["python3", MEDIA_RM, "season", str(p["id"]), ",".join(map(str, p["seasons"])), *hashes], 600
    desc = (f"DELETE {what} for good: {files} ({_gb(p['size'])}) from {p['path']}{tor}. "
            f"{p['app'].capitalize()} stops tracking it and adds a list exclusion so it is not grabbed again")
    return desc, ["python3", MEDIA_RM, p["kind"], str(p["id"]), *hashes], 600
