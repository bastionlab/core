# Architecture

How the core is put together, for people changing it. The user-facing overview is the [README](../README.md).
CT ids and addresses below are the defaults; each install's real ones live in `/etc/dash/config.json`.

| page | what lives there |
|---|---|
| `/` | the apps you open (Immich, Jellyfin, Seerr, …), alerts, one card per add-on |
| `/metrics` | host, GPU, storage, backups, uptime, containers, ports, tailnet, Discord webhooks, host shutdown |
| `/addons` | every add-on: on/off, install, update, remove; the marketplace |
| `/settings` | every connection's status in one list, config.json (edits go through Run + rebuild), Discord, each add-on's fields |

Everything else is an add-on in `addons/<id>/`: Notes, Learn, Kanji, Habits, Media, Dev, Game servers, Deals,
Flats, Jobs, Money, Chat, and Local AI (no tab of its own).

## Pieces

- `agent/` — runs on pve (`dash-agent.service`, <host LAN IP>:7070). Only answers CT 104 (and pve itself) with
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
  the private `bastionlab/addons` (the marketplace; HTTPS with the token file as credential helper). The checked-out
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

## Backup, releases, languages

- **Backup** (Settings → Backup, `agent/dash-backup`): `/etc/dash`, `/var/lib/dash` in the dashboard CT and each
  add-on's `backup:` paths (`- { ct: <cts key>, path: /var/lib/x }` in addon.yaml), plus the secrets encrypted
  with the owner's passphrase (`/etc/dash/backup.key`, never in a backup). Schedule in `/etc/dash/backup.json`
  (`dash-backup.timer`, 22:30), files in `/var/lib/dash-backups` or `<storage>/dash`. Restore previews what it
  replaces and moves every replaced path aside as `<path>.pre-restore-<time>`. Moving hosts:
  `./install.sh --from-backup <file>`.
- **Releases** (Add-ons → Core, `agent/core-update`): `VERSION` + `scripts/release <x.y.z>` (CHANGELOG.md from the
  commits, tag; push it and `.github/workflows/release.yml` publishes `bastion-core-<v>.tar.gz`). Channel
  stable/beta in `/etc/dash/core.json`; the replaced core is kept in `/var/lib/dash-core/old` for Roll back.
  Add-ons may require a core with `core: ">=0.2.0"`; installs, updates and core updates check it.
- **i18n** (`@nuxtjs/i18n`): strings in `web/i18n/locales/<lang>.json`, an add-on's in
  `addons/<id>/web/i18n/locales/<lang>.json` (keys under its id). Language, date and money format per login
  (Settings → Language & format; `fmtDate` / `fmtMoney` in `utils/locale.ts`). `scripts/i18n-lint` fails on new
  hardcoded template strings (baseline `web/i18n/raw-strings.json`; `--update` after moving some over).

## Access

1. **Network**: `tailscale serve` stamps each request with the person's login; only `NUXT_OWNER_LOGINS` gets past
   it. The LAN door (Caddy, `lan/Caddyfile`) proves itself with `NUXT_LAN_KEY`. Nothing is reachable from the internet.
2. **Who you are** (`server/utils/users.ts`, `/var/lib/dash/users.db`): an account signs in with name + password
   (+ a TOTP code once set up) or a passkey; the PIN stays as the owner's quick unlock. Settings → Account.
   Passkeys are bound to the host name, so they work on the tailnet name but not on the LAN IP.
   The session cookie carries the account and a per-user + global counter ("Sign out everywhere").
   Roles owner > admin > member > viewer (`web/shared/utils/roles.ts`): the owner invites people by a one-time
   link (Settings → Users); every `/api` route and action is checked for its role, the UI hides the rest.
   Other tailnet logins reach the sign-in page only when Settings → Users allows guests.
3. Every `/api` route needs that cookie; writes must also come from the dashboard's own origin.
4. Requests from inside CT 104 itself (`pct exec 104 -- curl …`) skip 1–3 — that is how Claude and scripts read the API.

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
