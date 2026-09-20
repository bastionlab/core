/**
 * The write half of the deals page. Like the agent's action allowlist, the
 * action name is validated here and every argument is rebuilt rather than
 * forwarded, so nothing the browser sends reaches CT 107 unchecked.
 */
const ACTIONS = ['add', 'edit', 'enable', 'disable', 'delete', 'feedback', 'rejudge'] as const
type Action = typeof ACTIONS[number]

const str = (v: any, max = 120) => String(v ?? '').trim().slice(0, max)
const list = (v: any) => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((x: any) => str(x, 60)).filter(Boolean).slice(0, 30)
const num = (v: any) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)))

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = str(body?.action, 20) as Action
  if (!ACTIONS.includes(action))
    throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })

  if (action === 'add' || action === 'edit') {
    const name = str(body.name, 48)
    const keyword = str(body.keyword, 120)
    if (!name || !keyword)
      throw createError({ statusCode: 400, statusMessage: 'name and search words are both required' })
    const shipping = ['any', 'ship', 'pickup'].includes(body.shipping) ? body.shipping : 'any'
    const spec = {
      name,
      keyword,
      terms: list(body.terms),
      exclude: list(body.exclude),
      min_price: num(body.minPrice),
      max_price: num(body.maxPrice),
      radius_km: Math.min(Math.max(num(body.radius) ?? 10, 0), 200),
      shipping,
      intent: str(body.intent, 600),
    }
    if (action === 'add') return deals(event, '/searches', { method: 'POST', body: spec })
    const editId = num(body.id)
    if (!editId) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
    return deals(event, `/searches/${editId}/edit`, { method: 'POST', body: spec })
  }

  if (action === 'feedback') {
    const verdict = body.verdict === 'up' || body.verdict === 'down' ? body.verdict : null
    return deals(event, '/feedback', {
      method: 'POST',
      body: { search_id: num(body.searchId), source: str(body.source, 32), source_id: str(body.sourceId, 32), verdict },
    })
  }

  const id = num(body.id)
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
  if (action === 'rejudge')
    return deals(event, `/searches/${id}/rejudge`, { method: 'POST', query: { all: !!body.all } })
  return deals(event, `/searches/${id}/${action}`, { method: 'POST' })
})
