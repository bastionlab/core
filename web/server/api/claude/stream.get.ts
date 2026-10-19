/** pipe the agent's server-sent events (one stream-json line of the turn each) straight through to the browser */
export default defineEventHandler(async (event) => {
  const { agentUrl, agentToken } = useRuntimeConfig(event)
  const { turn, from } = getQuery(event)
  const ctl = new AbortController()
  event.node.req.on('close', () => ctl.abort())
  const res = await fetch(`${agentUrl}/claude/stream?${new URLSearchParams({ turn: String(turn), from: String(from ?? 0) })}`, {
    headers: { Authorization: `Bearer ${agentToken}` }, signal: ctl.signal,
  })
  if (!res.ok || !res.body) throw createError({ statusCode: res.status === 400 ? 410 : 502, statusMessage: (await res.text()).slice(0, 200) })
  setResponseHeaders(event, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
  return sendStream(event, res.body)
})
