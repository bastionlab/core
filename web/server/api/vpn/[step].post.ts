/** remote access: provider (choose) · connect (headscale/netbird with the owner's own key) · wg-init · wg-peer (a device's WireGuard config) */
const STEPS: Record<string, string> = { 'provider': '/vpn/provider', 'connect': '/vpn/connect', 'wg-init': '/vpn/wg/init', 'wg-peer': '/vpn/wg/peer' }
export default defineEventHandler(async (event) => {
  const path = STEPS[getRouterParam(event, 'step') ?? '']
  if (!path) throw createError({ statusCode: 404 })
  const b = (await readBody(event)) ?? {}
  const s = (k: string, n = 200) => (typeof b[k] === 'string' ? b[k].slice(0, n) : '')
  return agent(event, path, { method: 'POST', body: { provider: s('provider', 20), server: s('server'), key: s('key'), name: s('name', 24), endpoint: s('endpoint', 120) } })
})
