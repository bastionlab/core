import type { H3Event } from 'h3'

/** call the money API in CT 108 (Firefly III + bank sync); bank secrets go in, never come back out */
export async function money<T = any>(event: H3Event, path: string, opts: { method?: 'GET' | 'POST', body?: any, query?: any, timeout?: number } = {}) {
  const { moneyUrl, moneyToken } = useRuntimeConfig(event)
  try {
    return await $fetch<T>(path, { baseURL: moneyUrl, headers: { Authorization: `Bearer ${moneyToken}` }, timeout: 30_000, ...opts })
  } catch (e: any) {
    const status = e?.response?.status
    throw createError({ statusCode: status === 400 || status === 404 ? status : 502, statusMessage: e?.data?.detail || `money: ${e?.message}` })
  }
}
