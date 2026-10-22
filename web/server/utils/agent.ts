import type { H3Event } from 'h3'

/** call the pve agent; its 400s (bad project, not a dev box) come back as readable errors */
export function agent<T = any>(event: H3Event, path: string, opts: UpstreamOpts = {}) {
  const { agentUrl, agentToken } = useRuntimeConfig(event)
  return upstream<T>('agent', agentUrl, agentToken, path, 60_000, opts)
}
