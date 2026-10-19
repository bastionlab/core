/** Claude on pve (agent /claude/*): send starts a turn in its own systemd unit, stop ends the chat's running turn, usage refreshes the plan numbers */
export default defineEventHandler(async (event) => {
  const action = getRouterParam(event, 'action')
  if (action === 'usage') return agent(event, '/claude/usage', { method: 'POST' }) // fresh numbers via a one-word Haiku call
  if (action !== 'send' && action !== 'stop') throw createError({ statusCode: 404 })
  const { chat, session, prompt, auto, model, effort } = await readBody(event)
  return agent(event, `/claude/${action}`, { method: 'POST', body: { chat, session, prompt, auto: auto === true, model, effort } })
})
