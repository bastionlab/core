/** pipe the agent's server-sent events (the pty output) straight through to the browser */
export default defineEventHandler((event) => {
  const { id, from } = getQuery(event)
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing id' })
  return agentStream(event, '/term/stream', { id: String(id), from: String(from ?? 0) })
})
