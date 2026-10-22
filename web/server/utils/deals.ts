import type { H3Event } from 'h3'

/** call the deals API in CT 107; it owns the SQLite file, we only ever read it or post a search */
export function deals<T = any>(event: H3Event, path: string, opts: UpstreamOpts = {}) {
  const { dealsUrl, dealsToken } = useRuntimeConfig(event)
  return upstream<T>('deals', dealsUrl, dealsToken, path, 15_000, opts)
}
