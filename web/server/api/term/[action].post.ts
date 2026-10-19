/** full-screen terminal: open / input / resize / close a `tmux attach` held by the agent */
export default defineEventHandler(async (event) => {
  const action = getRouterParam(event, 'action')
  if (!['open', 'input', 'resize', 'close'].includes(action!)) throw createError({ statusCode: 404 })
  return agent(event, `/term/${action}`, { method: 'POST', body: await readBody(event) })
})
