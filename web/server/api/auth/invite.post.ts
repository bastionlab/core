/** accept an invite: pick a name and password, signed in right away */
export default defineEventHandler(async (event) => {
  const wait = lockedFor()
  if (wait) throw createError({ statusCode: 429, statusMessage: `too many tries — wait ${wait} s` })
  const b = await readBody(event)
  const name = String(b?.name ?? '').trim()
  if (!NAME_RE.test(name)) throw createError({ statusCode: 400, statusMessage: 'Name: 2–32 letters, digits, . _ -' })
  const problem = pwProblem(String(b?.password ?? ''))
  if (problem) throw createError({ statusCode: 400, statusMessage: problem })
  try {
    const u = acceptInvite(String(b?.t ?? ''), name, String(b.password))
    issueCookie(event, u.id)
    return { ok: true }
  } catch (e: any) {
    recordAttempt(false)
    throw createError({ statusCode: 400, statusMessage: e?.message || 'failed' })
  }
})
