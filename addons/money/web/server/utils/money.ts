import type { H3Event } from 'h3'

/** call the money API in CT 108 (Firefly III + bank sync); bank secrets go in, never come back out */
export function money<T = any>(event: H3Event, path: string, opts: UpstreamOpts = {}) {
  const { moneyUrl, moneyToken } = useRuntimeConfig(event)
  return upstream<T>('money', moneyUrl, moneyToken, path, 30_000, opts)
}
