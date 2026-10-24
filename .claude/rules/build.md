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
- Everything beyond the core (Home, Notes, Chat, Metrics, Add-ons) is an add-on. Moved-out ones live in
  `addons/<id>/` (so far Learn, Kanji, Habits):
  - `addon.yaml` — id, name, icon, order (tab position), author, desc (one or two lines), routes, needs, ct,
    depends_on. The Add-ons page, nav entry and route guard all come from it (via `runtimeConfig.public.addons`).
  - `web/` — a Nuxt layer (`app/pages`, `app/components`, `server/api|utils|plugins`) the core extends; it may use
    the core's utils and composables (`agentCall`, `upstream`, `Panel`, …).
  - `agent/*.py` — loaded by the agent; register routes with `dash_sdk` (`@get`, `@post`) and use its `pct`,
    `sh`, `cached`, `ct`/`ip`, Claude-job helpers instead of importing core modules directly.
- `addon.yaml` also carries `version:` (x.y.z). Bump it on every change worth shipping, then run
  `python3 addons/build-index.py`: `addons/index.json` is the marketplace index (this folder stands in for the
  `pvedash/addons` repo). The app reads the real one from `config.json` `marketplace.index` and falls back to the
  copy it was built with; a higher version there shows as an Update badge on `/addons`.
- Install / Update / Remove on `/addons` are the `addon_*` actions: `agent/addon-get` fetches from
  `marketplace.repo` (one folder per add-on) or the entry's own GitHub repo, keeps every replaced copy in
  `/var/lib/dash-addons/old`, runs `install.sh` once on install, then `deploy.sh` in its own unit `dash-rebuild`
  (an agent restart would kill it as a child). Not offered to the Ask model.
- New add-on: `templates/new-addon <id> "<Name>"` (or `/new-addon`); release: `/publish-addon`.
- Not yet moved: the entries in `web/shared/utils/addons.ts`. A new feature starts as `addons/<id>/`, not there.
- Switched-off add-ons drop out of the nav/home and redirect to `/addons` (`useAddons().pageOn`,
  `middleware/pages.global.ts`). On/off state is `/var/lib/dash/addons.json` in CT 104; dependencies are checked
  both ways, so e.g. Local AI can't go off while Deals uses it.
- Local AI goes through `server/utils/ollama.ts`; sibling services through `upstream()` — never raw fetches with
  an address in them.

## Secrets
- Tokens and keys stay in gitignored files on pve (`agent/token`, `/etc/dash/*.json`, `/root/devbox/keys/`) or
  inside the add-on's own CT. They never reach the browser and never appear in an action's visible argv.
