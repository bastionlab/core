/** what an action would do, in the agent's own words, without running it (the Run button shows this) */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string, args?: any }>(event)
  requireRole(event, roleForAction(String(body?.name ?? '')))
  return agent(event, '/action/check', { method: 'POST', body: { name: String(body?.name ?? ''), args: body?.args ?? {} } })
})
