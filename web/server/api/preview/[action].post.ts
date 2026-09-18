export default defineEventHandler(async (event) => {
  const action = getRouterParam(event, 'action')
  if (action !== 'start' && action !== 'stop') throw createError({ statusCode: 404 })
  const { vmid, path } = await readBody(event)
  return agent(event, `/preview/${action}`, { method: 'POST', body: { vmid, path } })
})
