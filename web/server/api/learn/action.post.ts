/**
 * Every write to the Learn library. Same pattern as notes/action: the action is allowlisted and each argument rebuilt.
 */
const ACTIONS = ['queue', 'now', 'write', 'progress', 'done', 'delete', 'skill', 'skilldel'] as const
type Action = typeof ACTIONS[number]

const ints = (v: any, max = 64) => (Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < max).slice(0, max)

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = String(body?.action ?? '').slice(0, 20) as Action
  if (!ACTIONS.includes(action)) throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })

  if (action === 'queue' || action === 'now') {
    const topic = String(body.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (action === 'queue' && !topic) throw createError({ statusCode: 400, statusMessage: 'which topic?' })
    return queueTopic(topic, action === 'now')
  }

  // the owner's own word on a skill wins over the lessons' guesses
  if (action === 'skill' || action === 'skilldel') {
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'which skill?' })
    if (action === 'skilldel') dropSkill(name)
    else {
      const level = Math.round(Number(body.level))
      if (!(level >= 1 && level <= 5)) throw createError({ statusCode: 400, statusMessage: 'level is 1 to 5' })
      const area = (TRACKS as readonly string[]).includes(body.area) ? body.area : 'concepts'
      putSkill(name, area, level, body.note == null ? null : String(body.note).slice(0, 200), 'you')
    }
    return { skills: listSkills() }
  }

  const id = Math.round(Number(body?.id))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing lesson id' })
  if (action === 'write') return writeNow(id)
  if (action === 'progress') {
    const quiz: Record<string, number> = {}
    if (body.quiz && typeof body.quiz === 'object') {
      for (const [k, v] of Object.entries(body.quiz).slice(0, 64)) if (/^\d{1,2}$/.test(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10) quiz[k] = v as number
    }
    return saveProgress(id, {
      ...(body.read ? { read: ints(body.read) } : {}),
      ...(body.tasks ? { tasks: ints(body.tasks) } : {}),
      ...(body.quiz ? { quiz } : {}),
    })
  }
  if (action === 'done') return setDone(id, body.done !== false)
  deleteLesson(id)
  return { ok: true }
})
