import type { H3Event } from 'h3'

/** call the deals API in CT 107; it owns the SQLite file, we only ever read it or post a search */
export async function deals<T = any>(event: H3Event, path: string, opts: { method?: 'GET' | 'POST', body?: any, query?: any, timeout?: number } = {}) {
  const { dealsUrl, dealsToken } = useRuntimeConfig(event)
  try {
    return await $fetch<T>(path, { baseURL: dealsUrl, headers: { Authorization: `Bearer ${dealsToken}` }, timeout: 15_000, ...opts })
  } catch (e: any) {
    const status = e?.response?.status
    throw createError({ statusCode: status === 400 || status === 404 ? status : 502, statusMessage: e?.data?.detail || `deals: ${e?.message}` })
  }
}
