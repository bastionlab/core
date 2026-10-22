/**
 * The write half of the deals page. Like the agent's action allowlist, the
 * action name is validated here and every argument is rebuilt rather than
 * forwarded, so nothing the browser sends reaches CT 107 unchecked.
 */
const ACTIONS = ['add', 'edit', 'enable', 'disable', 'delete', 'feedback', 'rejudge'] as const
type Action = typeof ACTIONS[number]

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = cleanStr(body?.action, 20) as Action
  if (!ACTIONS.includes(action))
    throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })

  if (action === 'add' || action === 'edit') {
    const name = cleanStr(body.name, 48)
    const keyword = cleanStr(body.keyword, 120)
    if (!name || !keyword)
      throw createError({ statusCode: 400, statusMessage: 'name and search words are both required' })
    const shipping = ['any', 'ship', 'pickup'].includes(body.shipping) ? body.shipping : 'any'
    const spec = {
      name,
      keyword,
      terms: cleanList(body.terms),
      exclude: cleanList(body.exclude),
      min_price: cleanInt(body.minPrice),
      max_price: cleanInt(body.maxPrice),
      radius_km: Math.min(Math.max(cleanInt(body.radius) ?? 10, 0), 200),
      shipping,
      intent: cleanStr(body.intent, 600),
      // not editable in the form, only carried through so an edit doesn't reset them to the backend's defaults
      ...(cleanInt(body.minScore) != null ? { min_score: Math.min(Math.max(cleanInt(body.minScore)!, 0), 100) } : {}),
      ...(/^l\d{1,8}$/.test(String(body.locationId ?? '')) ? { location_id: body.locationId } : {}),
    }
    if (action === 'add') return deals(event, '/searches', { method: 'POST', body: spec })
    const editId = cleanInt(body.id)
    if (!editId) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
    return deals(event, `/searches/${editId}/edit`, { method: 'POST', body: spec })
  }

  if (action === 'feedback') {
    const verdict = body.verdict === 'up' || body.verdict === 'down' ? body.verdict : null
    return deals(event, '/feedback', {
      method: 'POST',
      body: { search_id: cleanInt(body.searchId), source: cleanStr(body.source, 32), source_id: cleanStr(body.sourceId, 32), verdict },
    })
  }

  const id = cleanInt(body.id)
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
  if (action === 'rejudge')
    return deals(event, `/searches/${id}/rejudge`, { method: 'POST', query: { all: !!body.all } })
  return deals(event, `/searches/${id}/${action}`, { method: 'POST' })
})
