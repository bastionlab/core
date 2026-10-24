/**
 * Every write to the notes. Same pattern as jobs/action: the action is allowlisted and each argument rebuilt.
 */
const ACTIONS = ['add', 'edit', 'append', 'rewrite', 'expand', 'undo', 'delete'] as const
type Action = typeof ACTIONS[number]

const str = (v: any, max: number) => String(v ?? '').slice(0, max)
const imgs = (v: any) => (Array.isArray(v) ? v : []).map(String).filter(imgOk).slice(0, 20)

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = str(body?.action, 20) as Action
  if (!ACTIONS.includes(action)) throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })

  if (action === 'add') {
    const raw = str(body.text, 50_000).trim()
    const images = imgs(body.images)
    if (!raw && !images.length) throw createError({ statusCode: 400, statusMessage: 'empty note' })
    return addNote(raw, images, body.ai !== false)
  }

  const id = Math.round(Number(body?.id))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing note id' })

  if (action === 'edit') {
    return editNote(id, {
      title: body.title == null ? undefined : str(body.title, 200).trim(),
      body: body.body == null ? undefined : str(body.body, 100_000),
      topic: body.topic == null ? undefined : cleanTopic(body.topic),
      kind: KINDS.includes(body.kind) ? body.kind : undefined,
      pinned: body.pinned == null ? undefined : !!body.pinned,
      state: STATES.includes(body.state) ? body.state : undefined,
      images: body.images == null ? undefined : imgs(body.images),
    })
  }
  if (action === 'append') {
    const text = str(body.text, 50_000).trim()
    const images = imgs(body.images)
    if (!text && !images.length) throw createError({ statusCode: 400, statusMessage: 'nothing to add' })
    return queueJob(id, { type: 'merge', text, images })
  }
  if (action === 'rewrite' || action === 'expand') return queueJob(id, { type: action })
  if (action === 'undo') return undoAi(id)
  deleteNote(id)
  return { ok: true }
})
