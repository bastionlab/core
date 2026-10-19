/**
 * The write half of the Jobs page. Same pattern as flats/action: the action is
 * allowlisted and every argument rebuilt, nothing is forwarded as-is.
 */
const ACTIONS = ['add', 'edit', 'enable', 'disable', 'delete', 'run', 'feedback', 'applied', 'suggest', 'cv', 'profile', 'cvdelete'] as const
type Action = typeof ACTIONS[number]

const str = (v: any, max = 120) => String(v ?? '').trim().slice(0, max)
const num = (v: any) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
const list = (v: any, max = 20, len = 60) => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((x: any) => str(x, len)).filter(Boolean).slice(0, max)
const only = <T extends string>(v: any, ok: readonly T[]) => list(v).filter((x): x is T => ok.includes(x as T))
const ref3 = (body: any) => ({ search_id: num(body.searchId), source: str(body.source, 32), source_id: str(body.sourceId, 64) })

const MODES = ['onsite', 'hybrid', 'remote'] as const
const LEVELS = ['junior', 'mid', 'senior', 'lead'] as const
const EMPLOYMENT = ['vollzeit', 'teilzeit', 'werkstudent', 'praktikum', 'ausbildung', 'freelance', 'minijob'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = str(body?.action, 20) as Action
  if (!ACTIONS.includes(action))
    throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })

  if (action === 'add' || action === 'edit') {
    const name = str(body.name, 48)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Name fehlt' })
    const spec = {
      name,
      wish: str(body.wish, 1500),
      keywords: list(body.keywords, 6),
      modes: only(body.modes, MODES),
      place: str(body.place, 120),
      radius_km: Math.min(Math.max(num(body.radius) ?? 25, 0), 200),
      employment: only(body.employment, EMPLOYMENT),
      permanent_only: !!body.permanentOnly,
      levels: only(body.levels, LEVELS),
      min_salary: num(body.minSalary),
      langs: only(body.langs, ['de', 'en'] as const),
      no_german: !!body.noGerman,
      no_agency: body.noAgency !== false,
      exclude: list(body.exclude),
      exclude_companies: list(body.excludeCompanies),
      max_age_days: Math.min(Math.max(num(body.maxAge) ?? 14, 1), 60),
      min_fit: Math.min(Math.max(num(body.minFit) ?? 60, 0), 100),
      sources: list(body.sources, 20, 32),
    }
    // empty keywords: CT 107 asks the model for them, which can take a cold model load
    const opts = { method: 'POST' as const, body: spec, timeout: 120_000 }
    if (action === 'add') return deals(event, '/jobs/searches', opts)
    const id = num(body.id)
    if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
    return deals(event, `/jobs/searches/${Math.round(id)}/edit`, opts)
  }

  if (action === 'feedback') {
    const verdict = body.verdict === 'up' || body.verdict === 'down' ? body.verdict : null
    return deals(event, '/jobs/feedback', { method: 'POST', body: { ...ref3(body), verdict } })
  }
  if (action === 'applied')
    return deals(event, '/jobs/applied', { method: 'POST', body: { ...ref3(body), applied: body.applied !== false } })

  if (action === 'suggest')
    return deals(event, '/jobs/suggest', { method: 'POST', body: { wish: str(body.wish, 1500) }, timeout: 120_000 })

  if (action === 'cv') {
    const data = String(body.data ?? '')
    if (!data || data.length > 12_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data))
      throw createError({ statusCode: 400, statusMessage: 'PDF fehlt oder ist zu groß (max. 8 MB)' })
    return deals(event, '/jobs/cv', { method: 'POST', body: { filename: str(body.filename, 200), data }, timeout: 180_000 })
  }
  if (action === 'profile')
    return deals(event, '/jobs/cv/profile', { method: 'POST', body: { profile: body.profile ?? {} } })
  if (action === 'cvdelete')
    return deals(event, '/jobs/cv/delete', { method: 'POST' })

  const id = num(body.id)
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
  return deals(event, `/jobs/searches/${Math.round(id)}/${action}`, { method: 'POST' })
})
