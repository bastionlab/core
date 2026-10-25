export default defineEventHandler(async (event) => {
  const wait = lockedFor()
  if (wait) throw createError({ statusCode: 429, statusMessage: `too many tries — wait ${wait} s` })
  try {
    const u = loginVerify(event, await readBody(event))
    recordAttempt(true)
    issueCookie(event, u.id)
    return { ok: true }
  } catch (e: any) {
    recordAttempt(false)
    throw createError({ statusCode: 401, statusMessage: `Passkey: ${e?.message || 'failed'}` })
  }
})
