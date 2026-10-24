/** game server actions in CT 110 — the agent validates every field again before gsm sees it */
const ACTIONS = new Set(['create', 'set', 'start', 'stop', 'restart', 'backup', 'restore', 'update', 'remove', 'cmd', 'playit', 'ct-start'])
export default defineEventHandler(async (event) => {
  const action = getRouterParam(event, 'action') ?? ''
  if (!ACTIONS.has(action)) throw createError({ statusCode: 404 })
  const b = (await readBody(event)) ?? {}
  const body = { id: b.id, template: b.template, name: b.name, settings: b.settings, apply: b.apply, file: b.file, version: b.version, command: b.command }
  return agent(event, `/games/${action}`, { method: 'POST', body })
})
