export default defineEventHandler(async (event) => {
  if (!pinConfigured(event)) throw createError({ statusCode: 503, statusMessage: 'no PIN set — run ./set-pin on pve, then ./deploy.sh' })
  const wait = lockedFor()
  if (wait) throw createError({ statusCode: 429, statusMessage: `too many tries — wait ${wait} s` })
  const pin = String((await readBody(event))?.pin ?? '')
  const ok = /^\d{4,12}$/.test(pin) && checkPin(event, pin)
  recordAttempt(ok)
  if (!ok) {
    const w = lockedFor()
    throw createError({ statusCode: 401, statusMessage: w ? `wrong PIN — locked for ${w} s` : 'wrong PIN' })
  }
  issueCookie(event)
  return { ok: true }
})
