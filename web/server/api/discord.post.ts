/** set/clear one channel's webhook, or send it a test message; the agent re-checks and copies it to the CTs */
const CHANNELS = ['deals', 'wohnungen', 'jobs', 'money', 'alerts']
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const channel = String(body?.channel ?? '')
  if (!CHANNELS.includes(channel)) throw createError({ statusCode: 400, statusMessage: 'unknown channel' })
  if (body?.action === 'test') return agent(event, '/discord/test', { method: 'POST', body: { channel } })
  const url = String(body?.url ?? '').trim().slice(0, 200)
  if (url && !/^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url))
    throw createError({ statusCode: 400, statusMessage: 'Das sieht nicht nach einer Discord-Webhook-URL aus' })
  return agent(event, '/discord', { method: 'POST', body: { channel, url } })
})
