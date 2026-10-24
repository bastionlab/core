/** fresh login shells in a dev box (tmux sessions sh-N on the agent's private socket): new / kill */
export default defineEventHandler(async (event) => {
  const action = getRouterParam(event, 'action')
  if (action !== 'new' && action !== 'kill') throw createError({ statusCode: 404 })
  const { vmid, session } = (await readBody(event)) ?? {}
  return agent(event, `/shells/${action}`, { method: 'POST', body: { vmid, session } })
})
