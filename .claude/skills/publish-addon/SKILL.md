---
name: publish-addon
description: Release a pvedash add-on to the marketplace (bump version, rebuild the index, open a PR to pvedash/addons). Use when the owner wants to share or update an add-on.
---

# Publish an add-on

1. Check `addons/<id>/` builds (scratch build) and holds no secrets, tokens, IPs or personal data.
2. Bump `version:` in `addons/<id>/addon.yaml` (patch for fixes, minor for features, major if it breaks setups).
3. Run `python3 build-index.py` inside `addons/`.
4. `addons/` is a checkout of `pvedash/addons`: `cd addons && git add <id> index.json && git commit && git push`
   (MaxJC0, no Claude lines). Other people's add-ons arrive as PRs to that repo; review before merging, the code
   runs as root on every install.
5. An add-on kept in its own repo instead: add `{"id", "name", "version", "author", "desc", "repo": "https://github.com/<o>/<r>"}`
   to `pvedash/addons/index.json` by PR; `build-index.py` keeps such entries.
6. Once merged, installs see it on /addons (Install, or "update to vX").
