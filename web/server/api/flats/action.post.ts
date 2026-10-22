/**
 * The write half of the Wohnungen page. Same pattern as deals/action: the
 * action is allowlisted and every argument rebuilt, nothing is forwarded as-is.
 */
const ACTIONS = ['add', 'edit', 'enable', 'disable', 'delete', 'feedback', 'profile', 'message'] as const
type Action = typeof ACTIONS[number]

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = cleanStr(body?.action, 20) as Action
  if (!ACTIONS.includes(action))
    throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })

  if (action === 'add' || action === 'edit') {
    const name = cleanStr(body.name, 48)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Name fehlt' })
    const mode = cleanPick(body.mode, ['city', 'pin'] as const, 'city')
    const spec = {
      name,
      mode,
      place: cleanStr(body.place, 120),
      lat: mode === 'pin' ? cleanNum(body.lat) : null,
      lon: mode === 'pin' ? cleanNum(body.lon) : null,
      radius_km: Math.min(Math.max(cleanNum(body.radius) ?? 0, 0), 100),
      min_area: cleanNum(body.minArea),
      max_area: cleanNum(body.maxArea),
      min_rooms: cleanNum(body.minRooms),
      max_rooms: cleanNum(body.maxRooms),
      min_warm: cleanNum(body.minWarm),
      max_warm: cleanNum(body.maxWarm),
      tausch: cleanPick(body.tausch, ['exclude', 'include', 'only'] as const, 'exclude'),
      wbs: cleanPick(body.wbs, ['any', 'without', 'only'] as const, 'any'),
      allow_temporary: !!body.allowTemporary,
    }
    if (action === 'add') return deals(event, '/flats/searches', { method: 'POST', body: spec })
    const id = cleanNum(body.id)
    if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
    return deals(event, `/flats/searches/${Math.round(id)}/edit`, { method: 'POST', body: spec })
  }

  if (action === 'feedback') {
    const verdict = body.verdict === 'up' || body.verdict === 'down' ? body.verdict : null
    return deals(event, '/flats/feedback', {
      method: 'POST',
      body: { search_id: cleanNum(body.searchId), source: cleanStr(body.source, 32), source_id: cleanStr(body.sourceId, 32), verdict },
    })
  }

  if (action === 'profile')
    return deals(event, '/flats/profile', { method: 'POST', body: { text: String(body.text ?? '').slice(0, 4000) } })

  if (action === 'message') {
    // qwen writes it in ~5 s when warm; a cold model load can take a minute
    return deals(event, '/flats/message', {
      method: 'POST',
      body: { source: cleanStr(body.source, 32), source_id: cleanStr(body.sourceId, 32), fresh: !!body.fresh },
      timeout: 120_000,
    })
  }

  const id = cleanNum(body.id)
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
  return deals(event, `/flats/searches/${Math.round(id)}/${action}`, { method: 'POST' })
})
