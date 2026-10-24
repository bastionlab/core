/**
 * The marketplace: the pvedash/addons index (config.json marketplace.index) next to what is installed here.
 * Until that repo exists, or when GitHub is unreachable, the index this build ships is used instead.
 * Install counts come from the counter Worker (marketplace.counter) when one is set.
 */
export interface MarketEntry {
  id: string, name: string, icon?: string, version: string, author: string, desc: string
  routes?: string[], needs?: string[], ct?: string, depends_on?: string[]
  /** folder in pvedash/addons, or … */
  path?: string
  /** … someone's own repo */
  repo?: string
}

const TTL = 10 * 60_000
let cache: { at: number, data: any } | null = null

/** true when a is a higher x.y.z than b */
export function newer(a = '', b = '') {
  const p = (v: string) => v.replace(/^v/, '').split('.').map(n => Number.parseInt(n) || 0)
  const [x, y] = [p(a), p(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

async function fetchIndex(url?: string) {
  if (!url) return null
  // raw.githubusercontent answers text/plain, so parse it ourselves
  const r = await $fetch<string>(url, { timeout: 8000, responseType: 'text' }).catch(() => null)
  try { const j = r && JSON.parse(r); return Array.isArray(j?.addons) ? j : null } catch { return null }
}

export async function marketplace(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data
  const m = cfg().marketplace ?? {}
  const remote = await fetchIndex(m.index)
  const index = remote ?? useRuntimeConfig().marketplaceLocal
  const counts: Record<string, number> = m.counter
    ? await $fetch<any>(`${m.counter.replace(/\/$/, '')}/counts`, { timeout: 5000 }).catch(() => ({}))
    : {}
  const here = new Map(allAddons().map(a => [a.id, a]))
  const addons = (index.addons as MarketEntry[]).map((e) => {
    const i = here.get(e.id)
    return {
      ...e,
      installs: typeof counts[e.id] === 'number' ? counts[e.id] : null,
      installed: i ? (i.version || 'built-in') : null,
      update: !!(i?.version && newer(e.version, i.version)),
    }
  })
  const data = { source: remote ? 'remote' : 'local', updated: index.updated ?? null, shareInstalls: !!m.share_installs, addons }
  cache = { at: Date.now(), data }
  return data
}
