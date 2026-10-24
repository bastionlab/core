/**
 * An add-on's values from /settings (addon.yaml `settings:`, defaults filled in), for its server code. The agent
 * keeps them on pve; this caches each add-on's for 30 s so a worker can ask every tick. Secrets never come here.
 */
const cache = new Map<string, { at: number, v: Record<string, any> }>()

export async function addonSettings(id: string): Promise<Record<string, any>> {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < 30_000) return hit.v
  const { agentUrl, agentToken } = useRuntimeConfig()
  const v = await upstream<Record<string, any>>('agent', agentUrl, agentToken, '/settings/values', 10_000, { query: { addon: id } })
  cache.set(id, { at: Date.now(), v })
  return v
}

/** drop the cache after the owner saved something, so the change applies on the next tick */
export const forgetAddonSettings = (id?: string) => (id ? cache.delete(id) : cache.clear())
