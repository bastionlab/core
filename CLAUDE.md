# Working on the dashboard

See README.md for what lives where. This file is how to change it without breaking the look or each other's work.

## Before you touch anything
- Other Claude sessions often edit this repo at the same time. Run `git status` and check mtimes of the files you
  plan to edit; never revert or reformat work you didn't do.
- Deploy with `./deploy.sh` (restarts the agent, rebuilds the app in CT 104). It ships the whole working tree,
  so don't deploy someone else's half-finished files.
- Unsure a change compiles? Test-build a scratch copy in CT 104 first (there is no node on pve):
  copy `/opt/dash/{node_modules,package.json,nuxt.config.ts}` to `/tmp/x` in CT 104, tar `web/{app,server,public}`
  into it, `npx nuxi build`, then delete `/tmp/x`.
- Commits: author MaxJC0 (repo-local git config is set). No Co-Authored-By / Claude / Anthropic lines, ever.
- Secrets (`agent/token`, `pin_hash`, `lan_key`) are gitignored; keep it that way.

## Who it is for
- One owner, mostly on a **Samsung Android phone** (~380px, Chrome / Samsung Internet), sometimes desktop.
  Design for the phone first; iOS quirks are secondary.
- UI language is **English** everywhere. Only content stays German: messages sent to sellers/landlords,
  ad titles, bank categories, AI reasons. Dates `en-GB`, money keeps de-DE € formatting.

## Design system (`web/app/assets/main.css`)
Use these; don't write page-local copies.
- Tokens: `--bg --panel --panel-2 --line --line-2 --text --muted --faint --accent(-soft) --ok/--warn/--bad(-soft)
  --track --radius (cards, 12px) --radius-sm (8px) --claude --term-bg`. No hex colours in components
  (chart palettes and xterm theme objects excepted).
- Layout/text: `.wrap` (from the layout — never nest another), `.grid .cols-2 .cols-3 .scroll-x`, `.sec` headings,
  `.muted .faint .small .mono .num`.
- Controls: `.btn` (`.primary .ghost .danger .sm .icon`), `.seg` segmented control (`<div class="seg"><button class="on">`),
  `.chip`/`.chip.on` filters, `.lnk` text button, `.pill(.ok/.warn/.bad/.accent)`, `.dot`, `.sure` (tap-twice delete
  via useArm), `.errbox`, `.empty-state`. Cards = `<Panel>`.
- Icons: `<Icon name="…">` (lucide paths in `components/Icon.vue`). Don't rely on rare unicode symbols (⏻ ⟲ ⛶)
  for meaning; Android fonts lack many. Common emoji are fine.

## Phone rules
- Inputs are forced to 16px on phones (no focus zoom); don't fight it.
- Touch targets ≥ ~32px: enlarge small buttons in `@media (pointer: coarse)` rather than bloating desktop.
- Nothing hover-only. Breakpoint for phone layout is `max-width: 640px`; the bottom tab bar height is `var(--tabbar)`.
- Wide content wraps or scrolls (`.scroll-x`); check 380px.
- Chat: keyboard mode is `html.kb` (visualViewport) and Enter = new line on touch. Keep both.

## Copy
- Keep on-screen prose to what's necessary: warnings ("Cannot be undone"), errors, first-run setup steps,
  one-line empty states. No paragraphs explaining how a feature works.
- `title=""` tooltips don't show on Android: fine for extra help, never for data the owner needs.
- Short, plain labels; same words for the same thing on every page ("Loading…", "Save", "Delete", "Nothing yet.").

## Asking the owner
In the dashboard chat there is no AskUserQuestion tool: end the answer with one fenced `questions` block
(1–4 questions, 2–4 options, recommended first) and stop.
