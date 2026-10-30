# Demo mode

Bastion with sample data, on any machine with Node 22 or newer. No host agent, Proxmox, Tailscale or Ollama is needed, and nothing real is read or written. Everything you see is invented.

```
demo/run [--port 3000] [--data <dir>] [--addons a,b,c] [--keep] [--no-build]
```

- `--port` where the app listens (default 3000, on 127.0.0.1 only; opening it from the same machine makes you the owner, there is no login).
- `--data` where the app keeps its databases (default `./.demo-data`, emptied on every start unless `--keep`). `demo/run` refuses `/var/lib/dash` and `/etc/dash`.
- `--addons` which add-ons to build in (default: designs, notes, habits, kanji, learn, chat, widgets, media, deals, flats, jobs, hunters, ai; add skins such as skin-glass or skin-material to try other looks).
- `--keep` keep the data of the last run (it is not seeded again).
- `--no-build` reuse `./.demo-build` as it is. Without it the build is redone only when a source file changed.

Quick start from a fresh clone: `git clone https://github.com/bastionlab/core && cd core && demo/run`, then open http://127.0.0.1:3000. Without an `addons/` folder the runner fetches the marketplace first (`DEMO_MARKETPLACE` points it at another clone or URL).

What `demo/run` does: builds the app into `./.demo-build` (with `NUXT_PUBLIC_DEMO=true`), starts `demo/agent.mjs`, starts the app against it, waits until it answers, replays the seeds and prints the URL. Ctrl-C stops both.

## How it works

`demo/agent.mjs` is one dependency-free process that plays four backends: the host agent (port 17070), Ollama (11435), the deals backend (18090) and the money backend (18091). For every request it looks in the fixtures of that service: `demo/fixtures/<service>.json` (core) merged with `addons/<id>/demo/<service>.json` of every add-on. `<service>` is `agent`, `ollama`, `deals` or `money`. Fixtures are re-read on every request, so you can edit them while the demo runs.

A fixture file is one JSON object of `"METHOD /path"` to the response:

```json
{
  "GET /status": { "searches": 1, "last_poll": "$ago:120" },
  "GET /feed": [ { "title": "Example item", "posted_at": "$ago:3600" } ],
  "GET /feed?show=rejected": [],
  "GET /things/*": { "ok": true }
}
```

- Matching: first a key with a query (`GET /feed?show=rejected` matches when the request has that parameter; the key with the most parameters wins), then the exact path without query, then the longest `METHOD /prefix*`.
- No match: GET answers 404 `{"error": "not found"}`; POST, PUT and DELETE answer `{"ok": true}` (nothing is stored). Event streams (`/claude/stream`, `/term/stream`) end at once. The bearer token is ignored.
- `GET /marketplace/index` is served from `addons/index.json` and `GET /marketplace/local` is `{}` unless a fixture says otherwise.
- Tokens, when a string value is exactly one of them: `"$now"` (unix seconds), `"$now_ms"`, `"$iso_now"`, `"$today"` (YYYY-MM-DD), `"$ago:<seconds>"` (unix seconds minus N, a negative N is in the future). Timestamps stay fresh that way.
- Take the response shapes from the real code (the add-on's `web/server/api`) or from the real backend. Copy the shape, never the values.

## Seeds

`demo/seed.json` and `addons/<id>/demo/seed.json` are lists that `demo/seed.mjs` replays after the app is up (core first, then add-ons alphabetically). The app's address is loopback, so writes work.

```json
[
  { "method": "POST", "path": "/api/notes/action", "body": { "action": "add", "text": "Buy a spare fan", "ai": false } },
  { "method": "POST", "path": "/api/habits/check", "body": { "habit": "h-walk", "day": "$day:3", "done": true } },
  { "db": "notes.db", "sql": "UPDATE notes SET created = created - ? WHERE id = ?", "params": [172800, 1] }
]
```

- `{method, path, body}` calls the app's own API; only use endpoints that exist.
- `{db, sql, params}` runs SQL on a database in the data dir, for what no API can set (backdating a row, say).
- Strings in a body may be `"$now"`, `"$now_ms"`, `"$iso_now"`, `"$ago_ms:<seconds>"` (whole value) or contain `$day:<n>` (the date n days ago).
- Ids of new rows count up from 1 in a fresh data dir, so a seed may refer to them.

## Adding demo data to an add-on

Put `addons/<id>/demo/agent.json` (and `deals.json`, `money.json`, `ollama.json` if it talks to those) next to a `seed.json` for what the page should already contain. Add-on fixtures win over the core ones for the same key.

## Privacy rule

Fixtures and seeds are published. Use only invented data: host `homelab`, LAN `192.168.1.x`, tailnet `example.ts.net`, people Alex and Sam, `https://example.com/...` links, generic project and company names. Never copy a value from a real install, not even "just a name". Before you commit, grep what you wrote for your own hostnames, addresses, e-mail addresses and tailnet.
