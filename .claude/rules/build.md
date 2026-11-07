# Build rules (loaded for every session in this repo)

How code is laid out so the dashboard can become a core + add-ons that friends install (Notes → "Dashboard
marketplace — plan").

## No hardcoded install values
- Tailnet, LAN subnet/host IP, CT ids and IPs, paths and owner logins come from `/etc/dash/config.json`
  (shape and fallback: `config.example.json`; the real file is never committed).
- Agent: `from config import ct, ip, TAILNET, HOST_IP, DASH_URL, DASHBOARD, DEVBOX` (`agent/config.py`).
- App server: `cfg()`, `ctIp('ai')`, `ctId('dl')`, `tsUrl('ai')` (`web/server/utils/config.ts`, auto-imported).
- Pages: `const { ts, ip, ctId, hostIp } = useDashConfig()` (served by `/api/config`, no secrets).
- `deploy.sh` reads it with `jq` and pushes it into the dashboard CT (`cts.dash`); Caddy gets `DASH_IP` / `LAN_SUBNET` from it.
- Comments and AI prompt prose may still name a CT by role; code may not hardcode ids.

## Add-ons
- The core is Home, Metrics and Add-ons. Every other tab is an add-on in `addons/<id>/` and can be switched off
  or removed on `/addons`:
  - `addon.yaml` — id, name, label (shorter tab name), icon, order (tab position; ≥ 90 = after Add-ons), author,
    version, desc (quoted: one or two lines), routes, home, needs, ct, depends_on, license (SPDX id; the core is
    AGPL-3.0, add-ons pick their own) and warning (quoted; terms-of-service or similar risk, shown on its card and
    before install), roles (`{ view, use }`: minimum role to see its pages + read its API / to write; default
    owner) and admin_actions (its actions an admin may run). Roles: `web/shared/utils/roles.ts`. The Add-ons page, nav entry
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
  - `palette:` — its entries in the command palette (⌘K): `{ label, to }` opens a page, `{ label, action, args }`
    opens the shared confirm card (`useConfirm().ask`) — never runs directly. Optional `icon`, `keywords`.
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
    config.json). A CT config.json already knows is left alone. Backend repos: bastionlab/deals (shared by
    Deals/Flats/Jobs through the `hunters` add-on), bastionlab/money.
  - `depends_on` is enforced on install too: Deals won't install before `hunters` and `ai`.
- `addon.yaml` also carries `version:` (x.y.z). Bump it on every change worth shipping, then run
  `python3 addons/build-index.py`: `addons/index.json` is the marketplace index (this folder stands in for the
  `bastionlab/addons` repo). The app reads the real one from `config.json` `marketplace.index` and falls back to the
  copy it was built with; a higher version there shows as an Update badge on `/addons`.
- Install / Update / Remove on `/addons` are the `addon_*` actions: `agent/addon-get` fetches from
  `marketplace.repo` (one folder per add-on) or the entry's own GitHub repo, keeps every replaced copy in
  `/var/lib/dash-addons/old`, runs `install.sh` once on install, then `deploy.sh` in its own unit `dash-rebuild`
  (an agent restart would kill it as a child). Not offered to the Ask model.
- Every install / update first passes `agent/addon_scan.py` (reverse shells, miners, decode-and-run, ssh keys,
  setuid, binaries, symlinks out, the dashboard's own secrets, …; ClamAV too when installed). `block` stops
  addon-get and backend-install (backend repos are scanned before bootstrap.sh); warnings show on the /addons
  confirm card (`/marketplace/scan`). Own add-ons must pass it: no `eval`/`exec` of decoded data, read only
  `/etc/dash/secrets/<own id>.json`. A false positive → `marketplace.scan_allow: ["<id>:<rule>"]` in config.json.
- Devices that post without a browser (a phone app, a PC script) use `/api/ingest/<id>/...` (add-on `server/api/ingest/<id>/`): auth.ts skips the Origin and session checks there but keeps the tailnet/LAN gate, so the handler MUST verify its own device token (see addons/life `lifeAuth`).
- New add-on: `templates/new-addon <id> "<Name>"` (or `/new-addon`); release: `/publish-addon`.
- Publishing = the Publish button on /addons (`addon_publish` → `agent/addon-publish`): a `publish/<id>` PR that
  `bastionlab/addons/.github/workflows/publish.yml` checks (`.github/check/check.py`: scope, manifest, owner, safety
  + ClamAV, leaks, style, ruff + ESLint) and merges itself when green. Run the gate before you publish:
  `python3 addons/.github/check/check.py --id <id> --pr addons`. Installs pull new versions hourly
  (`dash-addons-update.timer` → `addon-get autoupdate`; `marketplace.auto_update: false` turns it off) or on
  Refresh. An add-on with local edits is never auto-updated (`addon-get` `local_changes()`).
- Shared by several add-ons, so it stays in core: the Ask bar + chat engine (`/api/chat`, `/api/claude`, chats sync,
  `useAsk`/`useChats`), notes and deals server utils (chat images, AI context; Flats/Jobs), the hunter strip/tabs,
  `Panel`/`Stat`/`ServicesPanel`/`ContainersPanel`, and the agent's own modules (metrics, backups, claude,
  host actions, Discord hooks) — nothing in the core agent belongs to a single add-on any more.
  A new feature starts as `addons/<id>/` (`templates/new-addon`), never in core.
- `addons/` on this box is a sparse checkout of `bastionlab/addons`, not part of the core repo (`/addons/` is
  ignored). Edit an add-on there, bump its `version:`, run `python3 build-index.py`, then commit and push in
  `addons/`. Install / Remove = `git sparse-checkout add` / drop, Update = `git pull` (every installed add-on).
  On a box without the checkout (friends), `addon-get` copies folders instead.
- If `bastionlab/addons` (or your own marketplace repo) is private, `agent/addon-get` reads `marketplace.token_file` (default
  `paths.devbox`/keys/github_token) and sends it only to GitHub (header via env, never argv); the app gets the
  index from the agent (`/marketplace/index`), so the token never leaves the Proxmox host.
- Switched-off add-ons drop out of the nav/home and redirect to `/addons` (`useAddons().pageOn`,
  `middleware/pages.global.ts`). On/off state is `/var/lib/dash/addons.json` in the dashboard CT; dependencies are checked
  both ways, so e.g. Local AI can't go off while Deals uses it.
- Local AI goes through `server/utils/ollama.ts`; sibling services through `upstream()` — never raw fetches with
  an address in them.

## Users and roles
- Accounts + invites: `web/server/utils/users.ts`; roles owner > admin > member > viewer (`web/shared/utils/roles.ts`).
  `server/middleware/auth.ts` checks every `/api` route: `CORE_API` for core prefixes, else the add-on whose API
  prefix it is (`roles:`), else owner. Actions: `ADMIN_ACTIONS` + add-ons' `admin_actions`, else owner.
- New core API route: add it to `CORE_API` if anyone below owner needs it. Pages: `CORE_PAGE_ROLES`;
  `useAddons().pageOn` hides tabs/cards the role can't open. Server checks are what count; the UI only hides.
- Data is not per person yet: keep personal add-ons (notes, habits, kanji, money, …) at owner until they are.

## Secrets
- Tokens and keys stay in gitignored files on the Proxmox host (`agent/token`, `/etc/dash/*.json`, `paths.devbox`/keys/) or
  inside the add-on's own CT. They never reach the browser and never appear in an action's visible argv.
