# Design rules (loaded for every session in this repo)

How a page should look and read. Applies to the core and to every add-on.

- Writes go through propose-and-approve: anything that changes a box (restart, delete, install) is an action in
  `agent/actions.py` that the owner presses Run on; the UI never shells out itself.

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
- Loading = `<Skeleton kind="lines|rows|tiles|cards|band">` shaped like the content, not "Loading…" text; keep old
  data on screen while refreshing. Quick toggles are optimistic: flip at once, roll back with `useToast()` on failure
  (`optimistic(apply, undo, save)`). Actions run via `useActions().run` (jobs tray + finish toast for free).
- Icons: `<Icon name="…">` (lucide paths in `components/Icon.vue`). Don't rely on rare unicode symbols (⏻ ⟲ ⛶)
  for meaning; Android fonts lack many. Common emoji are fine.

## Phone rules
- Inputs are forced to 16px on phones (no focus zoom); don't fight it.
- Touch targets ≥ ~32px: enlarge small buttons in `@media (pointer: coarse)` rather than bloating desktop.
- Nothing hover-only. Breakpoint for phone layout is `max-width: 640px`; the bottom tab bar height is `var(--tabbar)`.
- Wide content wraps or scrolls (`.scroll-x`); check 380px.
- Chat: keyboard mode is `html.kb` (visualViewport) and Enter = new line on touch. Keep both.

## Copy
- New UI text goes through `$t()` (`web/i18n/locales/en.json`, an add-on's own `web/i18n/locales/`); run
  `scripts/i18n-lint`. Dates/money via `fmtDate` / `fmtMoney` (the viewer's format), not hardcoded locales.
- Keep on-screen prose to what's necessary: warnings ("Cannot be undone"), errors, first-run setup steps,
  one-line empty states. No paragraphs explaining how a feature works.
- `title=""` tooltips don't show on Android: fine for extra help, never for data the owner needs.
- Short, plain labels; same words for the same thing on every page ("Loading…", "Save", "Delete", "Nothing yet.").
