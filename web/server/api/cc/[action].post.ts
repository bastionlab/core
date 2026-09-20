/** start or stop a Claude Code session in a dev box (tmux, attach over SSH) */
export default defineEventHandler(async (event) => {
  const action = getRouterParam(event, 'action')
  if (action !== 'start' && action !== 'stop') throw createError({ statusCode: 404 })
  const { vmid, path, profile } = await readBody(event)
  return agent(event, `/cc/${action}`, { method: 'POST', body: { vmid, path, profile } })
})
