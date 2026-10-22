# pve dashboard

https://dash.example-tailnet.ts.net/ — tailnet only, owner's Tailscale login + a PIN.

| page | what lives there |
|---|---|
| `/` | the apps you open (Immich, Jellyfin, Seerr, …), alerts, one glance card per topic |
| `/chat` | Claude (on pve, read-only or ⚡Auto per message) or a local Ollama model; chats sync across devices |
| `/notes` | notebook the local model tidies (one topic per note, pasted images, undo) |
| `/dev` | dev boxes, projects, previews, git/GitHub, Claude Code and `/ship` sessions, web terminals, new project |
| `/media` | download stack: VPN verdict, queues, library, removing a film/series |
| `/metrics` | host, GPU, storage, backups, uptime, containers, ports, tailnet, Discord webhooks, host shutdown |
| `/deals` `/wohnungen` `/jobs` | the three hunters in CT 107 (`/root/deals`): searches, AI-judged feed, 👍/👎 |
| `/money` | Firefly III + bank sync in CT 108 (`/root/money`) |
| `/habits` | the habit tracker in CT 204, framed |

## Pieces

- `agent/` — runs on pve (`dash-agent.service`, 192.168.1.50:7070). Only answers CT 104 (and pve itself) with
  the bearer token in `agent/token`. `agent.py` is just the HTTP server; the rest is split by topic:
  `core` (shell helpers, cache, pools), `metrics`, `media`, `dev` (previews, shells, terminals), `github`,
  `actions` (the allowlist + jobs), `claude` (one `claude -p` systemd unit per chat turn).
  Helpers next to it: `media-rm` and `gh-new` (run as actions, keep secrets out of the visible argv),
  `hooks.py` (Discord webhooks, `/etc/dash/discord.json`), `alerts.py` + `dash-alerts.timer` (failed backups
  and full disks → #alerts every 15 min).
- `web/` — Nuxt 4, built and run in CT 104 `dash` (`/opt/dash`, `dash.service`, 127.0.0.1:3000, published with
  `tailscale serve`). Notes and chats are SQLite in `/var/lib/dash` there. Calls to the agent / CT 107 / CT 108 /
  Ollama all go through `server/utils/upstream.ts`.
- `/root/devbox/pv` — helper inside dev boxes (`pv ls|start|stop|log|cc|ccstop|cclog|shiplog|fetch|push|new|rm|remote`).
  Per-project overrides in `<project>/.dashboard.yml` (`command:`, `ports:`, `name:`).

Deploy after changes: `./deploy.sh` — links and reloads the agent's systemd units, restarts the agent, pushes `pv`
to the dev boxes, replaces the app sources in CT 104 and rebuilds. Needs a PIN first: `./set-pin` (in a real terminal).

## Access

1. `tailscale serve` stamps each request with the person's login; only `NUXT_OWNER_LOGINS` gets past it.
2. Every `/api` route needs the PIN cookie; writes must also come from the dashboard's own origin.
3. Requests from inside CT 104 itself (`pct exec 104 -- curl …`) skip 1 and 2 — that is how Claude and scripts read the API.

## The two AIs

- **Ask bar / local chat** (`server/api/ai/ask.post.ts`): Ollama in CT 105, with a snapshot of the page's data
  (`server/utils/context.ts`, `snapshot.ts`). It can only *propose* actions from `server/utils/actions.ts`; the
  owner presses Run and the agent validates the name and every argument again before building a fixed argv.
- **Claude** (`agent/claude.py`): Claude Code as root on pve. Read-only turns get a fixed allowlist of read
  commands; ⚡Auto turns run in Claude Code's auto mode, so treat Auto as root access.

## GitHub

Dev boxes share an SSH key, so cloning and pushing work out of the box. Public repos of the owner are listed
without a token; private ones and creating repos need `/root/devbox/keys/github_token` on pve (repo scope).

## Smoke test

`/opt/smoke` in CT 104 holds puppeteer + a headless Chrome and `smoke.mjs`, which loads the main pages, fails on
any console error and writes full-page screenshots next to itself: `pct exec 104 -- sh -c 'cd /opt/smoke && node smoke.mjs'`.
