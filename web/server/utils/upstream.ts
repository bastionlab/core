import type { H3Event } from 'h3'

export type UpstreamOpts = { method?: 'GET' | 'POST', body?: any, query?: any, timeout?: number }

/**
 * one JSON call to a sibling service (agent, deals, money, ollama). Its own 400/404 come back as readable errors
 * (FastAPI says `detail`, the agent and Ollama say `error`); anything else, including a timeout, is a 502.
 */
export async function upstream<T = any>(label: string, baseURL: string, token: string | null, path: string, timeout: number, opts: UpstreamOpts = {}) {
  try {
    return await $fetch<T>(path, { baseURL, headers: token ? { Authorization: `Bearer ${token}` } : {}, timeout, ...opts })
  } catch (e: any) {
    const status = e?.response?.status
    throw createError({ statusCode: status === 400 || status === 404 ? status : 502, statusMessage: e?.data?.detail || e?.data?.error || `${label}: ${e?.message}` })
  }
}

/** pipe one of the agent's server-sent event streams (a Claude turn, a terminal) straight through to the browser */
export async function agentStream(event: H3Event, path: string, query: Record<string, string>) {
  const { agentUrl, agentToken } = useRuntimeConfig(event)
  const ctl = new AbortController()
  event.node.req.on('close', () => ctl.abort())
  let res: Response
  try {
    res = await fetch(`${agentUrl}${path}?${new URLSearchParams(query)}`, { headers: { Authorization: `Bearer ${agentToken}` }, signal: ctl.signal })
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: `agent: ${e?.message}` })
  }
  // 400 = that turn / terminal is gone: 410 tells the browser to stop reconnecting
  if (!res.ok || !res.body) throw createError({ statusCode: res.status === 400 ? 410 : 502, statusMessage: (await res.text()).slice(0, 200) })
  setResponseHeaders(event, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
  return sendStream(event, res.body)
}
