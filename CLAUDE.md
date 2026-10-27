# Working on the dashboard

See docs/architecture.md for what lives where (README.md is the public overview). This file is how to change it without breaking the look or each other's work.

## Before you touch anything
- Other Claude sessions often edit this repo at the same time. Run `git status` and check mtimes of the files you
  plan to edit; never revert or reformat work you didn't do.
- No deploy step to see a change: `agent/dash-live` (service `dash-live`) watches the working tree and a few
  seconds after the last save restarts the agent (`.py`) and/or rebuilds the app in a copy in CT 104 (~15 s, swapped
  in only if the build is green). Its result: Settings → Deploy, `/var/lib/dash-live/status.json`,
  `journalctl -u dash-live`. Units, `deploy.sh`, `package.json`, Caddy still trigger the full `./deploy.sh`.
- **Deploy** = send the work to GitHub (Deploy button → `agent/dash-ship`: commits the whole tree, tags a core
  release, pushes, publishes changed add-ons). Only when the owner asks; it ships everyone's uncommitted work.
- Unsure a change compiles? Test-build a scratch copy in CT 104 first (there is no node on pve): copy
  `/opt/dash/node_modules` to `/tmp/x` in CT 104, ship the sources the way deploy.sh does
  (`tar -C . --exclude=node_modules --exclude=.git --exclude='addons/*/agent' --transform 's,^web/,,;s,^web$,.,' -cf - web addons`),
  `npx nuxi build`, then delete `/tmp/x`. If you start it, use `NOTES_DIR=<scratch dir> LEARN_WORKER=0` so it
  can't touch the real databases or start Claude jobs through the agent.
- Changed something the owner (or a friend running Bastion) would notice in the core? Add one line under
  `## Unreleased` in `CHANGELOG.md` (Features / Fixes). The next Deploy turns that into the release notes; with
  no notes it falls back to commit subjects, which the Deploy button's `deploy: <files>` commits don't give.
  Add-on changes go in the add-on, not here.
- Commits: author MaxJC0 (repo-local git config is set). No Co-Authored-By / Claude / Anthropic lines, ever.
- Secrets (`agent/token`, `pin_hash`, `lan_key`) are gitignored; keep it that way.

## Who it is for
- One owner, mostly on a **Samsung Android phone** (~380px, Chrome / Samsung Internet), sometimes desktop.
  Design for the phone first; iOS quirks are secondary.
- UI language is **English** everywhere. Only content stays German: messages sent to sellers/landlords,
  ad titles, bank categories, AI reasons. Dates `en-GB`, money keeps de-DE € formatting.

## Rules
`.claude/rules/design.md` (UI kit, phone, copy) and `.claude/rules/build.md` (config, add-ons, agent) are loaded
automatically; read them before changing a page or adding a feature.

## Asking the owner
In the dashboard chat there is no AskUserQuestion tool: end the answer with one fenced `questions` block
(1–4 questions, 2–4 options, recommended first) and stop.
