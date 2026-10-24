/**
 * Everything the dashboard can do beyond the core (Home, Notes, Chat, Metrics, Add-ons) is an add-on that can be
 * switched off. Phase 1 of the marketplace plan: switched-off add-ons drop out of the nav, the home page and their
 * routes; their CTs keep running. Add-ons already moved out live in addons/<id>/ (addon.yaml + a Nuxt layer) and
 * reach the app through runtimeConfig.public.addons; the entries below are the ones still built in.
 */
export interface Addon {
  id: string
  name: string
  icon: string
  /** addon.yaml only: position among the add-on tabs (lower = earlier) */
  order?: number
  /** pages that belong to it; none = a backend others build on (local AI) */
  routes: string[]
  author: string
  /** one or two lines: what it does for you */
  desc: string
  /** what the box needs to run it */
  needs: string[]
  /** config.json `cts` key of the container it lives in */
  ct?: string
  dependsOn?: string[]
}

export const CORE_PAGES = ['/', '/notes', '/chat', '/metrics', '/addons', '/login']

export const ADDONS: Addon[] = [
  { id: 'ai', name: 'Local AI', icon: 'spark', routes: [], author: 'MaxJC0', ct: 'ai',
    desc: 'Ollama + Open WebUI on the GPU. Powers the Ask bar and reads ads, postings and bank lines for the hunters and Money.',
    needs: ['NVIDIA GPU (8 GB+)', '16 GB RAM'] },
  { id: 'media', name: 'Media', icon: 'media', routes: ['/media'], author: 'MaxJC0', ct: 'dl',
    desc: 'VPN-isolated download stack (*arr, qBittorrent, Seerr) feeding Jellyfin and Audiobookshelf; queues, library, removal.',
    needs: ['VPN account', 'storage pool'] },
  { id: 'dev', name: 'Dev', icon: 'dev', routes: ['/dev'], author: 'MaxJC0',
    desc: 'Dev boxes as LXCs: projects, previews, git/GitHub, Claude Code and /ship lanes, web terminals.',
    needs: ['Claude login', 'GitHub token (optional)'] },
  { id: 'servers', name: 'Game servers', icon: 'gamepad', routes: ['/servers'], author: 'MaxJC0', ct: 'gameservers',
    desc: 'Minecraft, ARK and Satisfactory servers in Docker: power, console, settings, backups, playit.gg tunnel for friends.',
    needs: ['8 GB+ RAM per server', 'playit.gg (optional)'] },
  { id: 'deals', name: 'Deals', icon: 'deals', routes: ['/deals'], author: 'MaxJC0', ct: 'deals', dependsOn: ['ai'],
    desc: 'Watches Kleinanzeigen for your keywords, lets the local model judge each ad and pings Discord on a steal.',
    needs: ['Discord webhook (optional)'] },
  { id: 'flats', name: 'Flats', icon: 'key', routes: ['/wohnungen'], author: 'MaxJC0', ct: 'deals', dependsOn: ['ai'],
    desc: 'Rental flats from several portals, warm rent worked out, duplicates folded, a landlord message ready to send.',
    needs: [] },
  { id: 'jobs', name: 'Jobs', icon: 'briefcase', routes: ['/jobs'], author: 'MaxJC0', ct: 'deals', dependsOn: ['ai'],
    desc: 'Reads your CV, polls job portals and scores every posting for fit, with the apply link found for you.',
    needs: ['your CV'] },
  { id: 'money', name: 'Money', icon: 'euro', routes: ['/money'], author: 'MaxJC0', ct: 'money', dependsOn: ['ai'],
    desc: 'Firefly III with bank sync: categories, subscriptions, depot, net worth, forecast and a monthly report.',
    needs: ['bank login (Enable Banking)', 'own CT'] },
]

/** the add-on a page belongs to, if any */
export const addonOf = (list: Addon[], path: string) => list.find(a => a.routes.some(r => path === r || path.startsWith(r + '/')))
