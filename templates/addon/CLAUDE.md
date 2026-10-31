# __NAME__ (a Bastion add-on)

This folder plugs into the Bastion core (`<paths.dashboard>` on the host). Before changing anything, read the
core's rules — they apply here too:
- `../../.claude/rules/design.md` — UI kit, phone-first (Android Chrome / Samsung Internet), copy, propose-and-approve for writes
- `../../.claude/rules/build.md` — add-on layout, `addon.yaml`, config instead of hardcoded IDs/IPs, `dash_sdk`

Layout: `addon.yaml` (manifest), `web/` (Nuxt layer: `app/pages`, `app/components`, `server/api`), `agent/*.py`
(host side through `dash_sdk`), optional `install.sh` (runs once as root on install, e.g. to create its CT).
Test with a scratch build as the core's CLAUDE.md describes; ship with the Publish button on /addons. Its gate
(no hex colours in styles, no hardcoded IPs/tailnet/CT ids, no native confirm/alert, no secrets, ruff + ESLint
clean) runs locally too: `python3 ../.github/check/check.py --id <id> --pr ..` from this folder.
