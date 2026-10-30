# Contributing to Bastion

Thanks for helping. Bug reports, fixes, translations, new add-ons and designs are all welcome. This guide covers
the core (this repository). Add-ons, skins and widget packs have their own guide in the
[marketplace repository](https://github.com/bastionlab/addons#building-an-add-on).

## Where does my change belong?

| You want to | Go to |
|---|---|
| Report a bug or suggest a feature | an [issue](https://github.com/bastionlab/core/issues) (use the templates) |
| Fix or improve Home, Metrics, Add-ons, Settings, the agent or the installer | a pull request here |
| Add a new page, integration or tool | an **add-on**, not the core: `templates/new-addon` |
| Change an existing add-on | a pull request in [addons](https://github.com/bastionlab/addons) (its author publishes it) |
| Make a theme or skin | a design or skin in [addons](https://github.com/bastionlab/addons) |
| Report a security problem | privately, see [SECURITY.md](SECURITY.md) |

For bigger changes, open an issue first so we can agree on the shape before you write the code.

## Running Bastion from a clone

You need a Proxmox VE host you can experiment on; a nested Proxmox VM works well.

```sh
git clone https://github.com/bastionlab/core.git /root/dashboard   # or your fork
cd /root/dashboard
bash install.sh --dry-run        # see what it would do
bash install.sh                  # set it up from this clone
```

The installer uses the clone in `/root/dashboard` (another folder: set `BASTION_DIR`).

After the first install, `dash-live` watches the clone: a few seconds after you save a file it restarts the
agent (Python changes) or rebuilds the app in the dashboard container (web changes). A build that fails keeps
the previous app running; the result is shown under Settings → Deploy. Changes to systemd units, `deploy.sh`,
`package.json` or Caddy need a full `./deploy.sh`.

How the pieces fit together: [docs/architecture.md](docs/architecture.md). The coding rules both humans and AI
assistants follow are in [`.claude/rules/`](.claude/rules) (design and build).

## Ground rules

- **No hardcoded install values.** Addresses, container ids, tailnet names and paths come from
  `/etc/dash/config.json` (shape: `config.example.json`).
- **Phone first.** Check your change at about 380 px wide. Touch targets of at least 32 px, nothing hover-only.
- **English UI, translatable.** New strings go through `$t()` with keys in `web/i18n/locales/en.json`.
- **No emoji or decorative symbols in the interface**; use an icon or words.
- **Every change to the host is an action** in `agent/actions.py` that the user confirms. The web app never
  runs commands itself.
- **Secrets never reach the browser** and never appear on a command line.

## Before you open a pull request

These run in CI on every pull request; run them locally first:

```sh
python3 -m py_compile agent/*.py
bash -n install.sh deploy.sh
python3 scripts/i18n-lint
python3 scripts/emoji-lint
```

Then:

- Add one line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md) if users will notice the change.
- Describe how you tested it (which host, phone or desktop) in the pull request.
- Keep a pull request to one topic. Smaller ones get reviewed faster.

Pull requests to the core are reviewed and merged by the maintainer. `main` only changes through pull requests.

## Sign your commits (DCO)

There is no CLA. Instead every commit carries a sign-off line, which says you wrote the change or have the
right to submit it under the project's license
([Developer Certificate of Origin](https://developercertificate.org)):

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it for you. Contributions to the core are licensed under the AGPL-3.0, like the rest of it.

## Releases

The maintainer cuts releases with `scripts/release <x.y.z>`, which writes the changelog section and tags the
version; GitHub then builds the release that installs see under Add-ons → Core. A version with a dash
(`0.2.0-beta.1`) only reaches installs on the beta channel.

## Code of Conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
