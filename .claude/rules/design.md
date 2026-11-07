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
- Icons: `<Icon name="…">` (lucide line icons: custom paths in `components/Icon.vue`, the rest generated into
  `components/icon-paths.ts` by `scripts/gen-icons`; add a name to its ICONS list and re-run). One style: stroke
  1.75, round caps, 16 px in rows, 18 px in headers, colour from tokens.
- **No emoji or decorative symbols (✓ ✕ ⚠ ✎ ✦ …) in UI chrome**: buttons, menus, headers, tabs, toasts, empty
  states. Use an Icon, or plain words. Status = a `.dot` or a `.pill` with words. Emoji stay only as *content*
  (user text, notes, chat messages, ad titles). `scripts/emoji-lint` fails on new ones (baseline
  `web/i18n/emoji-baseline.json`). Also tell AI prompts not to write emoji; push/Discord titles are plain text.

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

## Look and feel
- Pages should look and feel good on both phone and PC. Neither comes first: design each layout for both.
- Not busy, not "AI-looking": quiet panels, aligned figures, colour spent on data and status. No gradient-heavy or
  decorative chrome unless the active skin asks for it.
- Motion: short, purposeful, interruptible. Animate transform/opacity only. Respect prefers-reduced-motion.
- **New add-ons (and new pages) meet this bar before they ship**, no half-finished design:
  - Premium look and feel: considered spacing, hierarchy and alignment, real empty/loading/error states, polished
    hover/press/focus states, short purposeful motion. Not a rough first draft that "works".
  - Works with every existing skin (`addons/skin-*`) and design: only core components (`Panel`, `PageTabs`, …) and
    tokens, no hex colours or own chrome. Open it under at least a light, a dark and a heavy skin (e.g. Terminal,
    Glass, Win11) and fix what breaks or looks off.
  - Equally good on phone (380px, touch, keyboard) and PC (mouse, wide). Design both layouts, test both.
  - Pick an icon that matches the topic (check `components/icon-paths.ts`; add one via `scripts/gen-icons` if no
    existing one fits) and use it in `addon.yaml` `icon:` and the page header. No generic placeholder icon.
- Taste skills (emil-design-eng, animate, review-animations) inform this rule; where they conflict with it, this rule wins.
