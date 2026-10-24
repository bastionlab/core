# Working on the dashboard

See README.md for what lives where. This file is how to change it without breaking the look or each other's work.

## Before you touch anything
- Other Claude sessions often edit this repo at the same time. Run `git status` and check mtimes of the files you
  plan to edit; never revert or reformat work you didn't do.
- Deploy with `./deploy.sh` (restarts the agent, rebuilds the app in CT 104). It ships the whole working tree,
  so don't deploy someone else's half-finished files.
- Unsure a change compiles? Test-build a scratch copy in CT 104 first (there is no node on pve): copy
  `/opt/dash/node_modules` to `/tmp/x` in CT 104, ship the sources the way deploy.sh does
  (`tar -C . --exclude=node_modules --exclude='addons/*/agent' --transform 's,^web/,,;s,^web$,.,' -cf - web addons`),
  `npx nuxi build`, then delete `/tmp/x`. If you start it, use `NOTES_DIR=<scratch dir> LEARN_WORKER=0` so it
  can't touch the real databases or start Claude jobs through the agent.
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
