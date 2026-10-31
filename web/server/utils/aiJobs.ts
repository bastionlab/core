import type { H3Event } from 'h3'

/**
 * Which local model a job uses (Local AI add-on, Jobs tab; map kept by the agent in /var/lib/dash-ai/jobs.json).
 * Job keys: ask, notes, voice, gist, chat, research, trending, hunters, money.
 * "Fall back to warm": the job's own model is used only while it is already loaded in VRAM, so a job never evicts
 * the warm model; otherwise the warm model, else the first installed model. Uncensored builds are never returned.
 * No setting (or no add-on, or the agent down) = the warm model, as before.
 */
const NOT_OFFERED = /abliterated|uncensored|heretic/i
const cache = { at: 0, map: {} as Record<string, string> }

async function jobMap(event?: H3Event) {
  if (Date.now() - cache.at < 15_000) return cache.map
  try {
    const { agentUrl, agentToken } = useRuntimeConfig(event)
    const r: any = await upstream('agent', agentUrl, agentToken, '/ai/jobs', 5_000)
    cache.map = r?.jobs && typeof r.jobs === 'object' ? r.jobs : {}
  } catch { cache.map = {} }
  cache.at = Date.now()
  return cache.map
}

/** model name for `job`, or null when Ollama has nothing usable */
export async function jobModel(job: string, event?: H3Event): Promise<string | null> {
  const [tags, ps, map]: any[] = await Promise.all([
    $fetch('/api/tags', { baseURL: ollamaBase(event), headers: { 'X-Job': 'dash' }, timeout: 10_000 }).catch(() => null),
    $fetch('/api/ps', { baseURL: ollamaBase(event), headers: { 'X-Job': 'dash' }, timeout: 10_000 }).catch(() => null),
    jobMap(event),
  ])
  const usable = (tags?.models ?? []).map((m: any) => m.name as string).filter((n: string) => !NOT_OFFERED.test(n))
  const loaded = (ps?.models ?? []).filter((m: any) => usable.includes(m.name))
  const own = map[job]
  if (own && loaded.some((m: any) => m.name === own)) return own
  const warm = loaded.find((m: any) => Date.parse(m.expires_at) - Date.now() > 24 * 3600_000)
  return warm?.name ?? usable[0] ?? null
}
