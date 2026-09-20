export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },
  ssr: false,
  app: {
    head: {
      title: 'pve',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark light' },
      ],
      link: [{ rel: 'icon', href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🖥️</text></svg>" }],
    },
  },
  css: ['~/assets/main.css'],
  runtimeConfig: {
    agentUrl: 'http://192.168.1.50:7070', // NUXT_AGENT_URL
    agentToken: '', // NUXT_AGENT_TOKEN
    ollamaUrl: 'http://192.168.1.55:11434', // NUXT_OLLAMA_URL
    dealsUrl: 'http://192.168.1.57:8090', // NUXT_DEALS_URL
    dealsToken: '', // NUXT_DEALS_TOKEN
  },
})
