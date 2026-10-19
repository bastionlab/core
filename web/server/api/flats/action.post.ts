/**
 * The write half of the Wohnungen page. Same pattern as deals/action: the
 * action is allowlisted and every argument rebuilt, nothing is forwarded as-is.
 */
const ACTIONS = ['add', 'edit', 'enable', 'disable', 'delete', 'feedback'] as const
type Action = typeof ACTIONS[number]

const str = (v: any, max = 120) => String(v ?? '').trim().slice(0, max)
const num = (v: any) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
const pick = <T extends string>(v: any, ok: readonly T[], dflt: T): T => (ok.includes(v) ? v : dflt)

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = str(body?.action, 20) as Action
  if (!ACTIONS.includes(action))
    throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })

  if (action === 'add' || action === 'edit') {
    const name = str(body.name, 48)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Name fehlt' })
    const mode = pick(body.mode, ['city', 'pin'] as const, 'city')
    const spec = {
      name,
      mode,
      place: str(body.place, 120),
      lat: mode === 'pin' ? num(body.lat) : null,
      lon: mode === 'pin' ? num(body.lon) : null,
      radius_km: Math.min(Math.max(num(body.radius) ?? 0, 0), 100),
      min_area: num(body.minArea),
      max_area: num(body.maxArea),
      min_rooms: num(body.minRooms),
      max_rooms: num(body.maxRooms),
      max_warm: num(body.maxWarm),
      tausch: pick(body.tausch, ['exclude', 'include', 'only'] as const, 'exclude'),
      wbs: pick(body.wbs, ['any', 'without', 'only'] as const, 'any'),
      allow_temporary: !!body.allowTemporary,
    }
    if (action === 'add') return deals(event, '/flats/searches', { method: 'POST', body: spec })
    const id = num(body.id)
    if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
    return deals(event, `/flats/searches/${Math.round(id)}/edit`, { method: 'POST', body: spec })
  }

  if (action === 'feedback') {
    const verdict = body.verdict === 'up' || body.verdict === 'down' ? body.verdict : null
    return deals(event, '/flats/feedback', {
      method: 'POST',
      body: { search_id: num(body.searchId), source: str(body.source, 32), source_id: str(body.sourceId, 32), verdict },
    })
  }

  const id = num(body.id)
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
  return deals(event, `/flats/searches/${Math.round(id)}/${action}`, { method: 'POST' })
})
