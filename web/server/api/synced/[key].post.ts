/** { upd, value } — newer than the stored copy wins; answers with whatever is stored afterwards */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')
  const body = await readBody<{ upd?: number, value?: any }>(event)
  if (!okSyncKey(key)) throw createError({ statusCode: 400, statusMessage: 'bad key' })
  if (JSON.stringify(body?.value ?? null).length > 50_000) throw createError({ statusCode: 413, statusMessage: 'too big' })
  return putSynced(key!, Math.round(Number(body?.upd)) || Date.now(), body?.value ?? null)
})
