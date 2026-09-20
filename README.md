# pve dashboard

https://dash.example-tailnet.ts.net/ — tailnet only. Five pages, each with its own AI prompt line:

| page | what lives there |
|---|---|
| `/` **Apps** | only the apps you actually open (Immich, Jellyfin, Seerr, Navidrome, Audiobookshelf, Open WebUI) + one card per topic |
| `/media` | the download stack: VPN verdict, queues split into films/series, music and audiobooks, library counts, disk usage, the *arr admin UIs |
| `/dev` | dev boxes, projects, previews, git/GitHub state, push, Claude Code sessions, new project |
| `/metrics` | host, GPU, storage, backups, containers, ports, tailnet |
| `/chat` | a light Open WebUI: conversation history in the browser, same local models |

- `agent/agent.py` — runs on pve (`dash-agent.service`, 192.168.1.50:7070). Read-only host data, the media-stack
  view (`/media`), dev-preview and Claude Code control, and the action allowlist. Only answers CT 104 (and pve
  itself) with the bearer token in `agent/token`.
- `web/` — Nuxt 4 app, built and run in CT 104 `dash` (`/opt/dash`, `dash.service`, 127.0.0.1:3000,
  published with `tailscale serve`). Service list + page grouping: `web/server/utils/services.ts`.
- `/root/devbox/pv` — helper inside dev boxes (`pv ls|start|stop|log|cc|ccstop|cclog|fetch|push|new`).
  Per-project overrides in `<project>/.dashboard.yml` (`command:`, `ports:`, `name:`).

Deploy after changes: `./deploy.sh` (restarts the agent, pushes pv to dev boxes, rebuilds the app).

## How the AI is wired

`web/server/api/ai/ask.post.ts` streams NDJSON from Ollama in CT 105. The page sends a `scope`
(`home | media | dev | metrics | chat`); `server/utils/context.ts` builds the snapshot for that scope
(`server/utils/snapshot.ts`) and `server/utils/actions.ts` offers only the actions that page is about.
The model can never run anything: it *proposes*, the owner presses Run, and the agent validates the
action name and every argument again before building a fixed argv (never a shell string).

## GitHub

Dev boxes share an SSH key, so cloning and pushing work out of the box. Listing your repos in the
"New project" picker needs a token: `echo <token> > /root/devbox/keys/github_token` on pve (repo scope).

## Smoke test

`/opt/smoke` in CT 104 holds puppeteer + a headless Chrome and `smoke.mjs`, which loads all five pages,
fails on any console error and writes full-page screenshots next to itself:
`pct exec 104 -- sh -c 'cd /opt/smoke && node smoke.mjs'`.
