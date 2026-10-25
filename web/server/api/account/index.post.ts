/**
 * Every change to your own account, one allowlisted `op` each:
 * create (the first owner account, from a PIN session) · password · totp-start / totp-confirm / totp-off ·
 * passkey-options / passkey-add / passkey-delete · signout-all
 */
const pendingTotp = new Map<number, { secret: string, at: number }>()

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const op = String(body?.op ?? '')
  const uid = Number(event.context.uid || 0)
  const bad = (msg: string, code = 400) => { throw createError({ statusCode: code, statusMessage: msg }) }

  if (op === 'create') {
    if (pinUser()) bad('an owner account already exists')
    if (!session(event) || uid) bad('unlock with the PIN first', 401)
    const name = String(body.name ?? '').trim()
    if (!NAME_RE.test(name)) bad('Name: 2–32 letters, digits, . _ -')
    const problem = pwProblem(String(body.password ?? ''))
    if (problem) bad(problem)
    const u = createUser(name, String(body.password), 'owner')
    issueCookie(event, u.id)
    return { ok: true, user: publicUser(u) }
  }

  const u = uid ? userById(uid) : undefined
  if (!u) bad('sign in with your account first', 401)
  const me = u!

  switch (op) {
    case 'password': {
      if (!checkPw(me, String(body.current ?? ''))) bad('current password is wrong', 403)
      const problem = pwProblem(String(body.password ?? ''))
      if (problem) bad(problem)
      setPw(me.id, String(body.password))
      bumpGen(me.id) // other devices sign in again
      issueCookie(event, me.id)
      return { ok: true }
    }
    case 'totp-start': {
      const secret = newTotpSecret()
      pendingTotp.set(me.id, { secret, at: Date.now() })
      const label = encodeURIComponent(`Bastion:${me.name}`)
      return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Bastion` }
    }
    case 'totp-confirm': {
      const p = pendingTotp.get(me.id)
      if (!p || Date.now() - p.at > 600_000) bad('start again')
      if (!checkTotp(p!.secret, String(body.code ?? '').trim())) bad('code does not match — check the phone clock')
      setTotp(me.id, p!.secret)
      pendingTotp.delete(me.id)
      return { ok: true }
    }
    case 'totp-off': {
      if (!checkPw(me, String(body.password ?? ''))) bad('password is wrong', 403)
      setTotp(me.id, '')
      return { ok: true }
    }
    case 'passkey-options': {
      if (!passkeyRp(event).ok) bad('passkeys need the host name, not an IP address')
      return registerOptions(event, me)
    }
    case 'passkey-add': {
      try { registerVerify(event, me, body.credential, String(body.label ?? '').trim() || 'Passkey') } catch (e: any) { bad(`Passkey: ${e?.message || 'failed'}`) }
      return { ok: true }
    }
    case 'passkey-delete':
      deletePasskey(me.id, String(body.id ?? ''))
      return { ok: true }
    case 'signout-all':
      bumpGen(me.id)
      bumpGlobalGen() // PIN sessions too
      issueCookie(event, me.id)
      return { ok: true }
  }
  bad(`unknown op: ${op}`)
})
