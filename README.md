# pve dashboard

https://dash.example-tailnet.ts.net/ — tailnet only, owner's Tailscale login + a PIN.

| page | what lives there |
|---|---|
| `/` | the apps you open (Immich, Jellyfin, Seerr, …), alerts, one card per add-on |
| `/metrics` | host, GPU, storage, backups, uptime, containers, ports, tailnet, Discord webhooks, host shutdown |
| `/addons` | every add-on: on/off, install, update, remove; the marketplace |
| `/settings` | every connection's status in one list, config.json (edits go through Run + rebuild), Discord, each add-on's fields |

Everything else is an add-on in `addons/<id>/`: Notes, Learn, Kanji, Habits, Media, Dev, Game servers, Deals,
Flats, Jobs, Money, Chat, and Local AI (no tab of its own).

## Pieces

- `agent/` — runs on pve (`dash-agent.service`, 192.168.1.50:7070). Only answers CT 104 (and pve itself) with
  the bearer token in `agent/token`. `agent.py` is just the HTTP server; the rest is split by topic:
  `core` (shell helpers, cache, pools), `metrics`, `actions` (the host's allowlist + jobs), `claude` (one
  `claude -p` systemd unit per chat turn), `dash_sdk` (what add-ons build on: routes, streams, actions, services,
  startup hooks). Everything an add-on does on the host lives in `addons/<id>/agent/` (Media: `media.py` +
  `media-rm`; Dev: `dev.py`, `github.py`, `devroutes.py`, `gh-new`; Game servers: `games.py` + `gsm`; Local AI:
  `localai.py` with the ollama actions and its containers) and is
  loaded only while that add-on is installed. `addons/<id>/deploy.sh` runs on every deploy (pv into dev boxes,
  gsm into the gameservers CT). `hooks.py` (Discord webhooks, `/etc/dash/discord.json`), `alerts.py` + `dash-alerts.timer` (failed backups
  and full disks → #alerts every 15 min).
- `web/` — Nuxt 4, built and run in CT 104 `dash` (`/opt/dash`, `dash.service`, 127.0.0.1:3000, published with
  `tailscale serve`). Notes and chats are SQLite in `/var/lib/dash` there. Calls to the agent / CT 107 / CT 108 /
  Ollama all go through `server/utils/upstream.ts`.
- `addons/<id>/` — every tab except Home/Metrics/Add-ons: `addon.yaml`, `web/` (a Nuxt layer the app extends) and
  `agent/*.py` (loaded through `agent/dash_sdk.py`). `addons/` is not part of this repo: it is a sparse checkout of
  the private `pvedash/addons` (the marketplace; HTTPS with the token file as credential helper). The checked-out
  folders are what is installed; `/addons` switches any of them off, installs, updates (a pull) or removes them.
- `/etc/dash/config.json` — this install's tailnet, LAN, CT ids/IPs and paths (shape: `config.example.json`).
- `/root/devbox/pv` — helper inside dev boxes (`pv ls|start|stop|log|cc|ccstop|cclog|shiplog|fetch|push|new|rm|remote`).
  Per-project overrides in `<project>/.dashboard.yml` (`command:`, `ports:`, `name:`).

Deploy after changes: `./deploy.sh` — links and reloads the agent's systemd units, restarts the agent, pushes `pv`
to the dev boxes, replaces the app sources in CT 104 and rebuilds. Needs a PIN first: `./set-pin` (in a real terminal).

## Fresh install

`install.sh` sets the core up on a new Proxmox host (asks for tailnet, LAN IP, CT id; creates the dashboard CT,
writes `/etc/dash/config.json`, PIN, first deploy). `./install.sh --dry-run` prints every step and changes nothing.
Add-ons then come from the Add-ons page (Install / Update / Remove, each shown and confirmed before it runs).

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
