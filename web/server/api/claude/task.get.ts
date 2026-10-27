/** tail of a background shell's output (the file path comes from the turn's task_started event; the agent only serves Claude's own tasks/*.output) */
export default defineEventHandler((event) => {
  const { file } = getQuery(event)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'missing file' })
  return agent(event, `/claude/task?${new URLSearchParams({ file: String(file) })}`)
})
