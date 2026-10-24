---
name: publish-addon
description: Release a pvedash add-on to the marketplace (Publish button / agent/addon-publish → GitHub checks → auto-merge). Use when the owner wants to share or update an add-on.
---

# Publish an add-on

Publishing is one button: **/addons → Publish** on the add-on's card (shown when `addons/<id>` differs from the
marketplace). It runs `agent/addon-publish <id>`; from a terminal the same is `python3 -I agent/addon-publish <id>`.

What happens:
1. The version goes up a patch if it isn't already higher than the marketplace's (written back into addon.yaml);
   a new add-on gets the publisher's GitHub login as `author`.
2. A pre-check on pve runs the marketplace's own gate (`pvedash/addons/.github/check/check.py`, no lint).
3. The folder is pushed to the `publish/<id>` branch and a PR opened. `.github/workflows/publish.yml` checks it:
   scope (only `<id>/`), manifest + version, owner (only the author or an org admin updates an add-on),
   safety scan + ClamAV, leaked secrets, style (no hex colours in styles, no hardcoded IPs / tailnet / CT ids,
   no native confirm/alert), ruff + ESLint. All green → it merges itself and rebuilds `index.json`.
4. Every install picks it up within the hour (`dash-addons-update.timer`, off with `marketplace.auto_update: false`)
   or on Refresh in /addons.

Before pressing it, make the gate pass locally: `python3 addons/.github/check/check.py --id <id> --pr addons`.
A failure is reported in the job log and as a comment on the PR; fix and Publish again (same branch, same PR).
A minor/major bump (features / breaking) is set by hand in addon.yaml before publishing.
