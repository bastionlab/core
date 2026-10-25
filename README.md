# Bastion

A phone-first dashboard for a self-hosted home server on Proxmox VE: what the host is doing, the apps you
run on it, and the actions you need, in one installable web app. Everything beyond the core is an add-on you
switch on, install or remove from the dashboard itself.

> **Not affiliated with Proxmox Server Solutions GmbH.** Proxmox is a registered trademark of Proxmox Server
> Solutions GmbH; this project only runs on it.

> **Use at your own risk.** The agent runs as **root on your hypervisor** and can start, stop and change
> containers. The software comes with no warranty (sections 15–16 of the [license](LICENSE)). Read what an
> action does before you press Run, and keep backups.

## What you get

- **Home**: tiles for your apps with health checks, alerts, one card per add-on, rearrangeable.
- **Metrics**: host, GPU, disks and SMART, storage pools, backups, containers, ports, the tailnet.
- **Actions with a confirm step**: every change is shown as exactly what will run, then you press Run.
  A local model (Ollama) can propose actions in plain language; it can never run one by itself.
- **Add-ons**: install, update, switch off or remove from the Add-ons page; each install is scanned and shown
  before it runs. Hourly auto-update is optional.
- **Phone first**: installable PWA, push notifications per topic, works on the tailnet and on the home LAN.
- **Backup and releases**: nightly encrypted backup of config, data and secrets; core updates with roll back.
- **Optional Claude**: a chat with Claude Code on the host (read-only by default, a switch for full access).

### Add-ons in the official marketplace

| Add-on | What it does |
|---|---|
| Notes | Quick-capture notebook the local model tidies |
| Chat | Claude Code on the host, in the browser |
| Local AI | Ollama + Open WebUI on your GPU |
| Media | Jellyfin + *arr stack status, requests and removal |
| Dev | Dev containers, project previews, web terminals |
| Game servers | Minecraft / ARK / Satisfactory in Docker |
| Habits, Kanji, Learn | Habit tracker, kanji SRS, a weekly lesson |
| Deals, Flats, Jobs, Money | Personal finders and finance ⚠ see the warning on each card |

Add-ons pick their own license and can carry a warning: a few talk to sites whose terms forbid automated
access or use unofficial APIs. They are for personal use, and you decide whether to install them.

## Requirements

- Proxmox VE 8 or newer, root shell on the host
- About 2 GB RAM and 8 GB disk for the dashboard container (more for add-ons)
- [Tailscale](https://tailscale.com) for access from outside your LAN (the LAN works without it)
- Optional: an NVIDIA GPU for Local AI, a Claude subscription or API key for the Claude features

## Install

On the Proxmox host, as root:

```sh
curl -fsSL https://raw.githubusercontent.com/bastionlab/core/main/install.sh | bash
```

Read it first if you like: `./install.sh --dry-run` prints every step and changes nothing. It asks for your
tailnet, LAN and the container id, creates the dashboard container and sets a PIN. Add-ons come later from the
Add-ons page. Moving to a new host: `./install.sh --from-backup <file>`.

## How it works

```
phone / laptop ──tailnet or LAN──▶ dashboard CT (Nuxt, PIN, Tailscale login)
                                        │ bearer token
                                        ▼
                                  agent on the Proxmox host (Python, allowlisted actions)
                                        │
                                  your containers and add-on backends
```

Details: [docs/architecture.md](docs/architecture.md). Writing an add-on: `templates/addon/`.

## Privacy

No telemetry. The dashboard talks to the internet only for what you turn on: GitHub for core and add-on updates
(the marketplace index is a static file), the weather on Home (Open-Meteo), Discord webhooks you configure,
and Claude when you use it. Sharing install counts with the marketplace is opt-in and off by default.

Claude features use **your own** Claude login or API key. None ships with the project.

## Contributing and license

Bug reports and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) (DCO sign-off, no CLA) and
the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md), please not in public.

The core is licensed under the [GNU AGPL-3.0](LICENSE): if you run a modified version for others over a
network, you share your changes. Add-ons choose their own license (shown on each card). Bundled third-party
code: [THIRD_PARTY.md](THIRD_PARTY.md).
