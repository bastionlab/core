export default defineNuxtConfig({
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
    agentUrl: 'http://192.168.1.50:7070', // NUXT_AGENT_URL
    agentToken: '', // NUXT_AGENT_TOKEN
    ollamaUrl: 'http://192.168.1.55:11434', // NUXT_OLLAMA_URL
    dealsUrl: 'http://192.168.1.57:8090', // NUXT_DEALS_URL
    dealsToken: '', // NUXT_DEALS_TOKEN
    moneyUrl: 'http://192.168.1.58:8090', // NUXT_MONEY_URL
    moneyToken: '', // NUXT_MONEY_TOKEN
    pinHash: '', // NUXT_PIN_HASH — scrypt hash written by ../set-pin
    ownerLogins: 'owner@example.com', // NUXT_OWNER_LOGINS — Tailscale logins let in (comma-separated)
  },
})
