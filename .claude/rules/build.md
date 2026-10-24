# Build rules (loaded for every session in this repo)

How code is laid out so the dashboard can become a core + add-ons that friends install (Notes → "Dashboard
marketplace — plan").

## No hardcoded install values
- Tailnet, LAN subnet/host IP, CT ids and IPs, paths and owner logins come from `/etc/dash/config.json`
  (shape and fallback: `config.example.json`; the real file is never committed).
- Agent: `from config import ct, ip, TAILNET, HOST_IP, DASH_URL, DASHBOARD, DEVBOX` (`agent/config.py`).
- App server: `cfg()`, `ctIp('ai')`, `ctId('dl')`, `tsUrl('ai')` (`web/server/utils/config.ts`, auto-imported).
- Pages: `const { ts, ip, ctId, hostIp } = useDashConfig()` (served by `/api/config`, no secrets).
- `deploy.sh` reads it with `jq` and pushes it into CT 104; Caddy gets `DASH_IP` / `LAN_SUBNET` from it.
- Comments and AI prompt prose may still say "CT 107"; code may not.

## Add-ons
- The core is Home, Metrics and Add-ons. Every other tab is an add-on in `addons/<id>/` and can be switched off
  or removed on `/addons`:
  - `addon.yaml` — id, name, label (shorter tab name), icon, order (tab position; ≥ 90 = after Add-ons), author,
    version, desc (quoted: one or two lines), routes, home, needs, ct, depends_on. The Add-ons page, nav entry
    and route guard all come from it (via `runtimeConfig.public.addons`).
  - `apps:` — the web apps it brings: `{ name, icon, note, group (app = Home tile; media/ai/infra = topic
    pages), hue, ct, port, ts (link the CT's tailnet name), health }`. They join the core's (Immich, Jellyfin,
    Audiobookshelf, Proxmox) in `server/utils/services.ts` only while the add-on is installed and on.
  - `settings:` — fields for /settings: `{ key, label, type (text|number|toggle|select|url), secret: true, help,
    options, default, min, max }`. Values in `/etc/dash/settings/<id>.json`, secrets in `/etc/dash/secrets/<id>.json`
    (root only, write-only from the browser). Server code reads `await addonSettings('<id>')`; host code
    `dash_sdk.setting()` / `secret()`. Quote keys YAML would read as booleans (on/off/yes/no).
  - `connections: /api/<id>/connections` — its outside links as `[{ id, name, ok, warn, detail, fix }]`; they join
    the core's (GitHub, Tailscale key, Discord, Claude) in Settings → Connections. `settings_ui: true` + a
    `Settings<Id>.global.vue` for a flow of its own (Money's bank logins).
  - `home: true` + `web/app/components/Home<Id>.global.vue` (renders the core `<TopicCard>`) = its card in Home's
    Sections; it fetches its own numbers.
  - `web/` — a Nuxt layer (`app/pages`, `app/components`, `server/api|utils|plugins`) the core extends; it may use
    the core's utils and composables (`agentCall`, `upstream`, `Panel`, …).
  - `agent/*.py` — loaded by the agent while installed, under their file name (must not clash with a core
    module). Register with `dash_sdk`: `@get`/`@post` (`regex=True` → `fn(body, match)`), `@stream` (SSE, gets the
    handler), `@action` (approve-then-Run, `(desc, argv, timeout)`), `services({...})` for service_restart,
    `@on_start` threads, `stale_after_jobs(...)`. Use its `pct`, `sh`, `cached`, `ct`/`ip`, `cts`, … rather than
    importing core modules. Helper scripts next to it reach the core via `Path(__file__).parents[3] / "agent"`.
  - `deploy.sh` (optional, executable) — run by the core's deploy.sh every time (e.g. push a helper into a CT).
  - `install.sh` (optional) — runs once on Install. An add-on with an app of its own (`backend:` repo, own CT)
    makes it one line: `agent/backend-install <cts key> <repo> <hostname> <MB> <GB> <features> [tun]`. That
    creates a Debian CT (DHCP), records `cts.<key>` in config.json, clones the repo into `paths.backends` and runs
    the repo's `bootstrap.sh` (first-time setup, `DASH_CT` = the CT) and `deploy.sh` (CT + addresses from
    config.json). A CT config.json already knows is left alone. Backend repos: pvedash/deals (shared by
    Deals/Flats/Jobs through the `hunters` add-on), pvedash/money, pvedash/habits.
  - `depends_on` is enforced on install too: Deals won't install before `hunters` and `ai`.
- `addon.yaml` also carries `version:` (x.y.z). Bump it on every change worth shipping, then run
  `python3 addons/build-index.py`: `addons/index.json` is the marketplace index (this folder stands in for the
  `pvedash/addons` repo). The app reads the real one from `config.json` `marketplace.index` and falls back to the
  copy it was built with; a higher version there shows as an Update badge on `/addons`.
- Install / Update / Remove on `/addons` are the `addon_*` actions: `agent/addon-get` fetches from
  `marketplace.repo` (one folder per add-on) or the entry's own GitHub repo, keeps every replaced copy in
  `/var/lib/dash-addons/old`, runs `install.sh` once on install, then `deploy.sh` in its own unit `dash-rebuild`
  (an agent restart would kill it as a child). Not offered to the Ask model.
- New add-on: `templates/new-addon <id> "<Name>"` (or `/new-addon`); release: `/publish-addon`.
- Shared by several add-ons, so it stays in core: the Ask bar + chat engine (`/api/chat`, `/api/claude`, chats sync,
  `useAsk`/`useChats`), notes and deals server utils (chat images, AI context; Flats/Jobs), the hunter strip/tabs,
  `Panel`/`Stat`/`ServicesPanel`/`ContainersPanel`, and the agent's own modules (metrics, backups, claude,
  host actions, Discord hooks) — nothing in the core agent belongs to a single add-on any more.
  A new feature starts as `addons/<id>/` (`templates/new-addon`), never in core.
- `addons/` on this box is a sparse checkout of `pvedash/addons`, not part of the core repo (`/addons/` is
  ignored). Edit an add-on there, bump its `version:`, run `python3 build-index.py`, then commit and push in
  `addons/`. Install / Remove = `git sparse-checkout add` / drop, Update = `git pull` (every installed add-on).
  On a box without the checkout (friends), `addon-get` copies folders instead.
- `pvedash/addons` is private for now: `agent/addon-get` reads `marketplace.token_file` (default
  `/root/devbox/keys/github_token`) and sends it only to GitHub (header via env, never argv); the app gets the
  index from the agent (`/marketplace/index`), so the token never leaves pve.
- Switched-off add-ons drop out of the nav/home and redirect to `/addons` (`useAddons().pageOn`,
  `middleware/pages.global.ts`). On/off state is `/var/lib/dash/addons.json` in CT 104; dependencies are checked
  both ways, so e.g. Local AI can't go off while Deals uses it.
- Local AI goes through `server/utils/ollama.ts`; sibling services through `upstream()` — never raw fetches with
  an address in them.

## Secrets
- Tokens and keys stay in gitignored files on pve (`agent/token`, `/etc/dash/*.json`, `/root/devbox/keys/`) or
  inside the add-on's own CT. They never reach the browser and never appear in an action's visible argv.
