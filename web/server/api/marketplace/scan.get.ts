/** the safety check of what Install / Update would bring (agent/addon_scan.py); slow the first time (a fetch) */
export default defineEventHandler((event) => {
  const id = String(getQuery(event).id ?? '')
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'bad add-on id' })
  const { agentUrl, agentToken } = useRuntimeConfig()
  return upstream<any>('agent', agentUrl, agentToken, `/marketplace/scan?id=${id}`, 180_000)
})
