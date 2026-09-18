import type { H3Event } from 'h3'

/** call the pve agent; its 400s (bad project, not a dev box) come back as readable errors */
export async function agent<T = any>(event: H3Event, path: string, opts: { method?: 'GET' | 'POST', body?: any, query?: any } = {}) {
  const { agentUrl, agentToken } = useRuntimeConfig(event)
  try {
    return await $fetch<T>(path, { baseURL: agentUrl, headers: { Authorization: `Bearer ${agentToken}` }, timeout: 60_000, ...opts })
  } catch (e: any) {
    throw createError({ statusCode: e?.response?.status === 400 ? 400 : 502, statusMessage: e?.data?.error || `agent: ${e?.message}` })
  }
}
