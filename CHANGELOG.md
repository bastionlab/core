# Changelog

What changed in each core release (add-ons keep their own). Newest first.

## Unreleased

## 0.1.1 (2026-10-27)

### Features

- Chat: Auto model and effort. A Haiku router sizes each message and picks the lead model, effort, team on/off and plan-first (capped at Opus medium); /model or /effort still override
- Page sections as one row of tabs at the top (`<PageTabs>` + `usePageTab`, open tab in the URL as `?s=`): Settings (5 categories + search), Metrics, Add-ons, and the hunters' Matches / Saved / Rejected / Searches
- Skins: a design can name a skin add-on that replaces the nav, backdrop, page frame, panels, stats, cards and page tabs
- Settings → Install: this box's `config.json` grouped and explained, each change approved and run via `config_set`
- Skins: the phone tab bar's four pins are shared by every look (`useNavPins`) and editable in each skin; skins can restyle icons and use a one-colour emoji font (`Bastion Emoji`)
- `CHANGELOG.md`, filled from these Unreleased notes on every release
- Chat (ideas from Odysseus): queue messages while Claude works, a stall warning with Nudge/Stop, edit a message or branch a chat (Claude sessions fork at that answer), context ring + Compact (`/compact`), voice input via Whisper on the 3060, ↑ recalls earlier messages, keys/passwords in answers blurred until tapped, in-app links like `/notes?n=4`
- Chat team mode: the chosen Claude model leads and hands reading/editing to cheaper subagents (scout/builder/checker on Haiku/Sonnet, Opus reviewer) when a task is big; tokens per model under each answer; `agent/local-sum` lets them have the local model read long logs for free
- Chat: push when Claude is done or waits for you (topic Chat), Plan → Execute, scheduled tasks (⏰, results as a chat, quiet unless something needs you), Compare models blind, read aloud (Kokoro on the 3060), save to Notes, Markdown export, incognito chats, action row sorted by what you use

### Fixes

- Chat voice input: the site's Permissions-Policy blocked the microphone (`microphone=()` → `microphone=(self)`)
- Chat voice input: the local model tidies the Whisper transcript (fillers, false starts, "wait no" corrections), raw text on any failure
- Read aloud starts within about a second: the summary streams and is spoken sentence by sentence, the first chunk is one sentence, and the summary no longer makes Ollama reload the warm model with a different context size
- Read aloud: long answers are read as a short summary by the local model; "read it all" behind ··· reads every word
- Chat: sending while Claude is still answering brings the running turn back instead of an error
- Live apply: the agent compile check works on newer Python (no `.pyc` to `/dev/null`)

## 0.1.0 (2026-10-25)

First tagged release, named Bastion (AGPL-3.0).

### Features

- Accounts: password + passkey + TOTP, roles (owner / admin / member / viewer) and invites in Settings → Users
- Core releases: `VERSION`, `scripts/release`, Add-ons → Core with stable / beta channels, changelog and one-tap rollback; add-ons declare the core range they need
- Settings → Backup: nightly, encrypted secrets, restore with preview, `install.sh --from-backup` for a new host
- No deploy step: `dash-live` applies every edit; the Deploy button only ships to GitHub
- i18n (`@nuxtjs/i18n`) with language, date and money format per login
- ⌘K command palette, jobs tray and toasts, skeleton loading, editable Home, Web Push per topic

<!-- Before 0.1.0 nothing was tagged: the sections below are checkpoints rebuilt from the git history. -->

## 0.0.5 (2026-10-24): Marketplace

- Every tab is an add-on in `addons/<id>/`; the core is Home, Metrics, Add-ons and Settings
- Install / Update / Remove on /addons, Publish button with a checked auto-merge, hourly auto-update
- Safety scan before every install; add-on apps in their own CT (`backend-install`)
- Settings page: all connections in one list, `config.json` editing, per-add-on fields; Secrets inventory with PIN change and token rotation
- `install.sh` for a fresh Proxmox host; no hardcoded install values (`/etc/dash/config.json`)
- LAN access through Caddy, with the service worker falling back between addresses
- Learn and Game servers tabs; the whole UI in English with shared controls

## 0.0.4 (2026-10-22): Money and security

- Money: tabs, spending calendar, 12-month trend, net worth, forecast, unusual charges, income and shared subscriptions, CSV export
- Discord as the one notification channel, a webhook per topic (Telegram removed)
- Owner tailnet login gate, same-origin writes, security headers
- Chats sync across devices; send Claude any file up to 20 MB
- Agent split into modules; one shared hunter view for Deals / Flats / Jobs
- Flats and Jobs search France too, with a profile or CV per search

## 0.0.3 (2026-10-20): Phone, Notes, Chat

- Phone nav: four pinned tabs + a More sheet
- Notes: quick capture with images, tidied into notes by the local model
- Chat: Claude Code on pve in read-only or auto mode, questions as buttons, / commands, working dots on the nav
- PIN lock in front of the whole API
- Jobs: CV upload, searches, matched postings with apply links
- Money: Firefly III ledger, bank + Trade Republic, categories, subscriptions
- Metrics ops panel: backup results, disk health, service uptime with restart
- Habits tab

## 0.0.2 (2026-10-19): Redesign, Flats, Dev

- Dark-only redesign: less text, collapsible panels
- Flats: rental flat hunter with saved flats, landlord message drafts and gone-ad checks
- Dev: Ship tab, a web terminal per dev box, live pane mirror
- Deals: warning pill on listings from brand-new seller accounts

## 0.0.1 (2026-09-20): First dashboard

- Agent on pve + Nuxt app in CT 104; Apps, Media, Dev, Metrics and Chat pages; bento home
- Dev: GitHub panel, create repos, side tmux view
- Deals: the Kleinanzeigen hunter feed with searches, AI verdicts and Abholen / Versand filters
