/** pipe the agent's server-sent events (one stream-json line of the turn each) straight through to the browser */
export default defineEventHandler((event) => {
  const { turn, from } = getQuery(event)
  if (!turn) throw createError({ statusCode: 400, statusMessage: 'missing turn' })
  return agentStream(event, '/claude/stream', { turn: String(turn), from: String(from ?? 0) })
})
