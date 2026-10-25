/** PIN (the owner's quick unlock) or name + password (+ the TOTP code once that is set up) */
export default defineEventHandler(async (event) => {
  const wait = lockedFor()
  if (wait) throw createError({ statusCode: 429, statusMessage: `too many tries — wait ${wait} s` })
  const body = await readBody(event)
  if (body?.name != null) {
    const u = userByName(String(body.name).trim().slice(0, 32))
    const ok = checkPw(u, String(body.password ?? '').slice(0, 200))
    if (ok && u!.totp && !body.code) return { totp: true } // right password; ask for the code, no attempt used up
    const good = ok && (!u!.totp || checkTotp(u!.totp, String(body.code ?? '').trim()))
    recordAttempt(good)
    if (!good) {
      const w = lockedFor()
      throw createError({ statusCode: 401, statusMessage: w ? `wrong name, password or code — locked for ${w} s` : 'wrong name, password or code' })
    }
    issueCookie(event, u!.id)
    return { ok: true }
  }
  if (!pinConfigured(event)) throw createError({ statusCode: 503, statusMessage: 'no PIN set — run ./set-pin on pve, then ./deploy.sh' })
  const pin = String(body?.pin ?? '')
  const ok = /^\d{4,12}$/.test(pin) && checkPin(event, pin)
  recordAttempt(ok)
  if (!ok) {
    const w = lockedFor()
    throw createError({ statusCode: 401, statusMessage: w ? `wrong PIN — locked for ${w} s` : 'wrong PIN' })
  }
  issueCookie(event, pinUser()?.id ?? 0)
  return { ok: true }
})
