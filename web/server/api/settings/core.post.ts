/** replace one of the host's keys (GitHub token, Tailscale auth key); write-only, the agent validates the format */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  return agent(event, '/settings/core', { method: 'POST', body: { key: String(b?.key ?? ''), value: String(b?.value ?? '').slice(0, 300) } })
})
