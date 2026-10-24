import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseYAML } from 'confbox'

// add-ons (addons/<id>/: addon.yaml + web/ Nuxt layer). In the repo they sit next to web/; deploy.sh copies them
// into /opt/dash/addons in CT 104
const here = import.meta.dirname
const root = existsSync(join(here, 'addons')) ? join(here, 'addons') : resolve(here, '../addons')
const addonDirs = existsSync(root) ? readdirSync(root).filter(d => existsSync(join(root, d, 'addon.yaml'))).sort() : []
// app tiles an add-on brings (addon.yaml `apps:`), server-side only: URLs are built from config.json at runtime
const addonApps: any[] = []
const addons = addonDirs.map((d) => {
  const m: any = parseYAML(readFileSync(join(root, d, 'addon.yaml'), 'utf8'))
  for (const a of m.apps ?? []) addonApps.push({ ...a, addon: m.id })
  return { id: m.id, name: m.name, label: m.label, icon: m.icon, version: String(m.version ?? ''), order: m.order ?? 100, routes: m.routes ?? [], home: !!m.home, connections: m.connections, settingsUi: !!m.settings_ui, author: m.author, desc: m.desc, needs: m.needs ?? [], ct: m.ct, dependsOn: m.depends_on?.length ? m.depends_on : undefined }
}).sort((a, b) => a.order - b.order) // order: where its tab sits among the add-on tabs
// the marketplace index this build ships (addons/index.json, rebuilt by addons/build-index.py): used until the real one is reachable
const marketplaceLocal = existsSync(join(root, 'index.json')) ? JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')) : { addons: [] }

export default defineNuxtConfig({
  extends: addonDirs.map(d => join(root, d, 'web')).filter(existsSync),
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },
  ssr: false,
  app: {
    head: {
      title: 'pve',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'theme-color', content: '#0a0c10' },
      ],
      link: [{ rel: 'icon', href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🖥️</text></svg>" }],
    },
  },
  css: ['~/assets/main.css'],
  // the SPA shell must be revalidated or phones (iOS home-screen apps especially) keep showing the old build after a deploy;
  // /_nuxt/* is content-hashed and keeps its long cache
  routeRules: {
    '/**': { headers: { 'cache-control': 'no-cache', 'x-frame-options': 'SAMEORIGIN', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' } },
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  },
  runtimeConfig: {
    agentUrl: '', // NUXT_AGENT_URL — deploy.sh fills these from /etc/dash/config.json
    agentToken: '', // NUXT_AGENT_TOKEN
    ollamaUrl: '', // NUXT_OLLAMA_URL
    dealsUrl: '', // NUXT_DEALS_URL
    dealsToken: '', // NUXT_DEALS_TOKEN
    moneyUrl: '', // NUXT_MONEY_URL
    moneyToken: '', // NUXT_MONEY_TOKEN
    pinHash: '', // NUXT_PIN_HASH — scrypt hash written by ../set-pin
    ownerLogins: '', // NUXT_OWNER_LOGINS — Tailscale logins let in (comma-separated)
    marketplaceLocal,
    addonApps,
    public: { addons }, // add-ons from addons/*/addon.yaml, merged with the built-in list (shared/utils/addons.ts)
    lanKey: '', // NUXT_LAN_KEY — shared with Caddy (lan/Caddyfile) so LAN requests can be told apart
  },
})
