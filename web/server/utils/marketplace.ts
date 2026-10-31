/**
 * The marketplace: the bastionlab/addons index next to what is installed here. The agent fetches it (it holds the
 * GitHub token a private repo needs); when it can't, it answers with the local addons/index.json, and when the
 * agent itself is unreachable the copy this build ships is used.
 * Install counts come from the counter Worker (marketplace.counter) when one is set.
 */
export interface MarketEntry {
  id: string, name: string, icon?: string, version: string, author: string, desc: string
  routes?: string[], needs?: string[], ct?: string, depends_on?: string[]
  /** SPDX id; warning: terms-of-service or similar risk, shown before install */
  license?: string, warning?: string
  /** folder in bastionlab/addons, or … */
  path?: string
  /** 'widget' for widget packs; missing = a normal add-on */
  kind?: string
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

async function fetchIndex(force: boolean) {
  const { agentUrl, agentToken } = useRuntimeConfig()
  return upstream<any>('agent', agentUrl, agentToken, `/marketplace/index${force ? '?fresh=1' : ''}`, 20_000).catch(() => null)
}

/** add-ons here whose folder differs from the marketplace's ({ id: 'new' | 'changed' }): they get a Publish button */
async function fetchLocal() {
  const { agentUrl, agentToken } = useRuntimeConfig()
  return upstream<Record<string, string>>('agent', agentUrl, agentToken, '/marketplace/local', 20_000).catch(() => ({}))
}

export async function marketplace(force = false) {
  const local = await fetchLocal()
  if (!force && cache && Date.now() - cache.at < TTL) return { ...cache.data, local }
  const m = cfg().marketplace ?? {}
  const got = await fetchIndex(force)
  const index = got?.addons ? got : { ...useRuntimeConfig().marketplaceLocal, source: 'local' }
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
  const data = { source: index.source === 'remote' ? 'remote' : 'local', updated: index.updated ?? null, shareInstalls: !!m.share_installs, addons, designs: index.designs ?? [] }
  cache = { at: Date.now(), data }
  return { ...data, local }
}
