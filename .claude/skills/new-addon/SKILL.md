---
name: new-addon
description: Scaffold a new Bastion add-on in addons/<id> from templates/addon and build it out. Use when the owner wants a new dashboard tab/feature.
---

# New add-on

1. Pick an id (lowercase, dashes) and a display name; ask if unclear.
2. Run `templates/new-addon <id> "<Name>"` from the dashboard root (`/root/dashboard`).
3. Fill in `addons/<id>/addon.yaml` (desc, icon, needs, depends_on, ct). Keep `version: 0.1.0` until first publish.
4. Build the feature inside that folder only: pages/components in `web/app/`, API in `web/server/api/`,
   host work in `agent/<id>.py` through `dash_sdk` (`@get`/`@post`, `pct`, `ct`/`ip`). Follow
   `.claude/rules/design.md` and `.claude/rules/build.md`; no hardcoded CT ids, IPs or tailnet names.
5. If it needs its own container, write an idempotent `install.sh` (runs once as root on install, gets
   `DASH_CONFIG`) that creates the CT and adds it to `/etc/dash/config.json` under `cts.<id>`.
6. Test-build a scratch copy as `CLAUDE.md` describes (`NOTES_DIR` scratch + `LEARN_WORKER=0`), then deploy.
