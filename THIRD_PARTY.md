# Third-party notices

The core is AGPL-3.0 ([LICENSE](LICENSE)). It bundles or builds on the following, under their own licenses.

## Shipped with the source

| What | License | Where |
|---|---|---|
| Symbols Nerd Font (icon glyphs for the terminals) | MIT (glyphs from their own projects, mostly MIT / OFL-1.1) | `web/public/fonts/`, license file next to it |
| Lucide icon shapes | ISC | `web/app/components/Icon.vue` |
| Contributor Covenant 2.1 | CC-BY-4.0 | `CODE_OF_CONDUCT.md` |
| brag-slim agent skill (latent-spaces/brag) | MIT | `.claude/skills/brag-slim/`, license file next to it |

## Installed at build time (npm)

| Package | License |
|---|---|
| nuxt, vue, @nuxtjs/i18n | MIT |
| marked | MIT |
| @xterm/xterm and addons (fit, webgl, unicode11) | MIT |
| leaflet | BSD-2-Clause |
| confbox | MIT |

Their dependencies (about 460 packages) are MIT, ISC, Apache-2.0, BSD-2/3-Clause, BlueOak-1.0.0, MPL-2.0,
CC0-1.0, 0BSD and Python-2.0, all compatible with the AGPL-3.0. Each package's license ships inside
`node_modules/<package>/`.

## On the host (Python)

| Package | License |
|---|---|
| PyYAML | MIT |

Add-ons are not part of the core and carry their own licenses (`license:` in each `addon.yaml`).
