/** run an action the owner approved in the Ask bar; the agent validates the name and arguments again */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string, args?: any }>(event)
  return agent(event, '/action/run', { method: 'POST', body: { name: String(body?.name ?? ''), args: body?.args ?? {} } })
})
