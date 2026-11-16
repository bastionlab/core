/** Claude sign-in from the browser: start (returns the URL to open), code (the pasted code finishes it), cancel */
export default defineEventHandler(async (event) => {
  const step = getRouterParam(event, 'step')
  if (step !== 'start' && step !== 'code' && step !== 'cancel') throw createError({ statusCode: 404 })
  const b = (await readBody(event)) ?? {}
  return agent(event, `/claude/auth/${step}`, { method: 'POST', body: { mode: b.mode === 'console' ? 'console' : 'claudeai', code: typeof b.code === 'string' ? b.code.slice(0, 400) : '' } })
})
