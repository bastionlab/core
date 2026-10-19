import type { H3Event } from 'h3'

/** call the Ollama API in CT 105 (ai) */
export async function ollama<T = any>(event: H3Event, path: string, opts: { method?: 'GET' | 'POST', body?: any, timeout?: number } = {}) {
  const { ollamaUrl } = useRuntimeConfig(event)
  try {
    return await $fetch<T>(path, { baseURL: ollamaUrl, timeout: 10_000, ...opts })
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: `ollama: ${e?.data?.error || e?.message}` })
  }
}

// abliterated/uncensored models are for Open WebUI only — never offered or defaulted to on the dashboard
const UNCENSORED = /abliterated|uncensored|heretic/i

/** installed models + what is loaded right now (and how much of it sits in VRAM) */
export async function aiModels(event: H3Event) {
  const [tags, ps] = await Promise.all([ollama(event, '/api/tags'), ollama(event, '/api/ps')])
  const loaded = new Map<string, any>((ps.models ?? []).map((m: any) => [m.name, m]))
  return (tags.models ?? [])
    .map((m: any) => {
      const l = loaded.get(m.name)
      return {
        name: m.name, size: m.size, uncensored: UNCENSORED.test(m.name), family: m.details?.family, params: m.details?.parameter_size, quant: m.details?.quantization_level,
        loaded: l ? { size: l.size, vram: l.size_vram, until: l.expires_at, ctx: l.context_length } : null,
        // keep_alive -1 gives an expiry centuries out: this is the model the warm-model timer holds in
        // VRAM, so it answers instantly and is what the Ask box should default to
        warm: !!l && Date.parse(l.expires_at) - Date.now() > 24 * 3600_000,
      }
    })
    .sort((a: any, b: any) => b.size - a.size)
}
