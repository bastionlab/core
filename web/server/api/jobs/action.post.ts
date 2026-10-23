/**
 * The write half of the Jobs page. Same pattern as flats/action: the action is
 * allowlisted and every argument rebuilt, nothing is forwarded as-is.
 */
const ACTIONS = ['add', 'edit', 'enable', 'disable', 'delete', 'run', 'feedback', 'applied', 'suggest', 'cv', 'profile', 'cvdelete'] as const
type Action = typeof ACTIONS[number]

const only = <T extends string>(v: any, ok: readonly T[]) => cleanList(v).filter((x): x is T => ok.includes(x as T))
const ref3 = (body: any) => ({ search_id: cleanNum(body.searchId), source: cleanStr(body.source, 32), source_id: cleanStr(body.sourceId, 64) })

const MODES = ['onsite', 'hybrid', 'remote'] as const
const LEVELS = ['junior', 'mid', 'senior', 'lead'] as const
const EMPLOYMENT = ['vollzeit', 'teilzeit', 'werkstudent', 'praktikum', 'ausbildung', 'freelance', 'minijob'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = cleanStr(body?.action, 20) as Action
  if (!ACTIONS.includes(action))
    throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })

  if (action === 'add' || action === 'edit') {
    const name = cleanStr(body.name, 48)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Name fehlt' })
    const spec = {
      name,
      wish: cleanStr(body.wish, 1500),
      keywords: cleanList(body.keywords, 6),
      modes: only(body.modes, MODES),
      place: cleanStr(body.place, 120),
      radius_km: Math.min(Math.max(cleanNum(body.radius) ?? 25, 0), 200),
      employment: only(body.employment, EMPLOYMENT),
      permanent_only: !!body.permanentOnly,
      levels: only(body.levels, LEVELS),
      min_salary: cleanNum(body.minSalary),
      langs: only(body.langs, ['de', 'en'] as const),
      no_agency: body.noAgency !== false,
      exclude: cleanList(body.exclude),
      exclude_companies: cleanList(body.excludeCompanies),
      max_age_days: Math.min(Math.max(cleanNum(body.maxAge) ?? 14, 1), 60),
      min_fit: Math.min(Math.max(cleanNum(body.minFit) ?? 60, 0), 100),
      sources: cleanList(body.sources, 20, 32),
    }
    // empty keywords: CT 107 asks the model for them, which can take a cold model load
    const opts = { method: 'POST' as const, body: spec, timeout: 120_000 }
    if (action === 'add') return deals(event, '/jobs/searches', opts)
    const id = cleanNum(body.id)
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
    return deals(event, '/jobs/suggest', { method: 'POST', body: { wish: cleanStr(body.wish, 1500) }, timeout: 120_000 })

  if (action === 'cv') {
    const data = String(body.data ?? '')
    if (!data || data.length > 12_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data))
      throw createError({ statusCode: 400, statusMessage: 'PDF fehlt oder ist zu groß (max. 8 MB)' })
    return deals(event, '/jobs/cv', { method: 'POST', body: { filename: cleanStr(body.filename, 200), data, search_id: cleanInt(body.searchId) || null }, timeout: 180_000 })
  }
  if (action === 'profile') {
    const p = body.profile ?? {}
    const profile = {
      ...Object.fromEntries(['name', 'headline', 'location', 'education'].map(k => [k, cleanStr(p[k], 300)])),
      summary: cleanStr(p.summary, 1200),
      roles: cleanList(p.roles, 30, 80), skills: cleanList(p.skills, 30, 80), languages: cleanList(p.languages, 30, 80),
      level: cleanPick(p.level, LEVELS, 'mid'),
      years: Math.min(Math.max(cleanInt(p.years) ?? 0, 0), 60),
    }
    return deals(event, '/jobs/cv/profile', { method: 'POST', body: { profile, search_id: cleanInt(body.searchId) || null } })
  }
  if (action === 'cvdelete')
    return deals(event, '/jobs/cv/delete', { method: 'POST', query: cleanInt(body.searchId) ? { search: cleanInt(body.searchId) } : {} })

  const id = cleanNum(body.id)
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing search id' })
  return deals(event, `/jobs/searches/${Math.round(id)}/${action}`, { method: 'POST' })
})
