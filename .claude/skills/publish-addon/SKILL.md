---
name: publish-addon
description: Release a pvedash add-on to the marketplace (bump version, rebuild the index, open a PR to pvedash/addons). Use when the owner wants to share or update an add-on.
---

# Publish an add-on

1. Check `addons/<id>/` builds (scratch build) and holds no secrets, tokens, IPs or personal data.
2. Bump `version:` in `addons/<id>/addon.yaml` (patch for fixes, minor for features, major if it breaks setups).
3. Run `python3 addons/build-index.py` and commit both (author MaxJC0, no Claude attribution lines).
4. Marketplace = the `pvedash/addons` repo (one folder per add-on + `index.json`). Open a PR there that copies
   `addons/<id>/` and the updated `index.json`:
   `gh repo clone pvedash/addons /tmp/pa && rsync -a --delete --exclude agent/__pycache__ addons/<id>/ /tmp/pa/<id>/`,
   rebuild the index there, then `gh pr create`. If the org or repo doesn't exist yet, stop and say so.
5. An add-on kept in its own repo instead: add `{"id", "name", "version", "author", "desc", "repo": "https://github.com/<o>/<r>"}`
   to `pvedash/addons/index.json` by PR; `build-index.py` keeps such entries.
6. Once merged, installs see it on /addons (Install, or "update to vX").
