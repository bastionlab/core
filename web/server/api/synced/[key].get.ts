/** one shared setting: { upd, value } (value null = never saved) */
export default defineEventHandler((event) => {
  const key = getRouterParam(event, 'key')
  if (!okSyncKey(key)) throw createError({ statusCode: 400, statusMessage: 'bad key' })
  return getSynced(key!)
})
