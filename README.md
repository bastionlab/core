# pve dashboard

https://dash.example-tailnet.ts.net/ — tailnet only.

- `agent/agent.py` — runs on pve (`dash-agent.service`, 192.168.1.50:7070). Read-only host data plus
  dev-preview start/stop/log. Only answers CT 104 (and pve itself) with the bearer token in `agent/token`.
- `web/` — Nuxt 4 app, built and run in CT 104 `dash` (`/opt/dash`, `dash.service`, 127.0.0.1:3000,
  published with `tailscale serve`). Services list: `web/server/utils/services.ts`.
- `/root/devbox/pv` — preview helper inside dev boxes (`pv ls|start|stop|log`). Per-project overrides in
  `<project>/.dashboard.yml` (`command:`, `ports:`, `name:`).

Deploy after changes: `./deploy.sh` (restarts the agent, pushes pv to dev boxes, rebuilds the app).
