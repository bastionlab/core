/** every write to the Kanji deck; the action is allowlisted and each argument rebuilt */
const ACTIONS = ['answer', 'undo', 'forget', 'settings'] as const
type Action = typeof ACTIONS[number]

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = String(body?.action ?? '').slice(0, 20) as Action
  if (!ACTIONS.includes(action)) throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })
  if (action === 'undo') return undo()
  if (action === 'settings') {
    return putSettings({
      ...(body.newPerDay != null ? { newPerDay: Number(body.newPerDay) || 0 } : {}),
      ...(Array.isArray(body.levels) ? { levels: body.levels.slice(0, 5) } : {}),
      ...(body.writing != null ? { writing: body.writing === true } : {}),
    })
  }
  // a reading card is the kanji, its write card `w:<kanji>`
  const k = String(body.k ?? '').slice(0, 4)
  if (action === 'forget') return forget(k.slice(0, 2))
  const secs = Number(body.secs)
  return answer(k, Math.round(Number(body.rating)), secs > 0 && secs < 3600 ? Math.round(secs * 10) / 10 : null)
})
