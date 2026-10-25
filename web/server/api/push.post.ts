/** { op: subscribe | topics | remove | route | test, … } — the agent checks every field again */
const OPS = ['subscribe', 'topics', 'remove', 'route', 'test']
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const op = String(b?.op ?? '')
  if (!OPS.includes(op)) throw createError({ statusCode: 400, statusMessage: 'unknown op' })
  const body: Record<string, any> = { op }
  if (op === 'subscribe') Object.assign(body, { sub: { endpoint: String(b.sub?.endpoint ?? ''), keys: { p256dh: String(b.sub?.keys?.p256dh ?? ''), auth: String(b.sub?.keys?.auth ?? '') } }, name: String(b.name ?? '').slice(0, 60), topics: Array.isArray(b.topics) ? b.topics.map(String) : null })
  if (op === 'topics') Object.assign(body, { id: String(b.id ?? ''), topics: Array.isArray(b.topics) ? b.topics.map(String) : [] })
  if (op === 'remove' || op === 'test') body.id = String(b.id ?? '')
  if (op === 'route') Object.assign(body, { topic: String(b.topic ?? ''), route: String(b.route ?? '') })
  return agent(event, '/push', { method: 'POST', body })
})
