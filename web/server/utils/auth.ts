import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * A PIN in front of the whole API. The PIN itself never lives here: deploy.sh puts its scrypt hash in
 * NUXT_PIN_HASH (`scrypt:<salt hex>:<hash hex>`, written by ./set-pin on pve). A correct PIN gets a session
 * cookie (no Max-Age, so it ends with the browser session) carrying its issue time + an HMAC; changing the PIN
 * or the agent token invalidates every cookie.
 */
export const COOKIE = 'dash_s'
const MAX_AGE = 7 * 86400 // even a browser that never ends its session logs in again after a week

const pinHash = (event: H3Event) => String(useRuntimeConfig(event).pinHash || '')
const key = (event: H3Event) => createHash('sha256').update(`${useRuntimeConfig(event).agentToken}\n${pinHash(event)}`).digest()
const sign = (event: H3Event, data: number | string) => createHmac('sha256', key(event)).update(String(data)).digest('hex')

export const pinConfigured = (event: H3Event) => /^scrypt:[0-9a-f]+:[0-9a-f]+$/.test(pinHash(event))

export function checkPin(event: H3Event, pin: string) {
  const [, salt, hash] = pinHash(event).split(':')
  const want = Buffer.from(hash!, 'hex')
  const got = scryptSync(pin, Buffer.from(salt!, 'hex'), want.length, { N: 16384, r: 8, p: 1 })
  return timingSafeEqual(got, want)
}

/**
 * Cookie: `<iat>.<uid>.<gen>.<mac>` — uid 0 = a PIN unlock before any account exists. The MAC also covers the
 * user's and the global "sign out everywhere" counters (utils/users.ts), so bumping one ends those sessions.
 * The old `<iat>.<mac>` PIN cookie stays valid until the first global sign-out.
 */
export function issueCookie(event: H3Event, uid = 0) {
  const iat = Math.floor(Date.now() / 1000)
  const gen = uid ? (userById(uid)?.gen ?? 0) : 0
  const body = `${iat}.${uid}.${gen}`
  setCookie(event, COOKIE, `${body}.${sign(event, `${body}.${globalGen()}`)}`, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' })
}

/** the session in the cookie, or null; uid 0 = PIN unlock without an account */
export function session(event: H3Event): { uid: number } | null {
  if (!pinConfigured(event) && !anyUsers()) return null
  const parts = String(getCookie(event, COOKIE) ?? '').split('.')
  const t = Number(parts[0])
  if (!t || Date.now() / 1000 - t > MAX_AGE) return null
  const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  if (parts.length === 2) return globalGen() === 0 && eq(parts[1]!, sign(event, parts[0]!)) ? { uid: pinUser()?.id ?? 0 } : null
  if (parts.length !== 4) return null
  const uid = Number(parts[1]), gen = Number(parts[2])
  if (!eq(parts[3]!, sign(event, `${t}.${uid}.${gen}.${globalGen()}`))) return null
  if (uid && userById(uid)?.gen !== gen) return null
  return { uid }
}
export const validCookie = (event: H3Event) => !!session(event)

/**
 * Commands inside CT 104 itself (`pct exec 104 -- curl 127.0.0.1:3000/api/…`, how Claude reads the notes) skip
 * the PIN. Everything from the tailnet arrives through `tailscale serve`, which also connects from loopback but
 * always adds X-Forwarded-For, so that header is what tells the two apart.
 */
export function fromInsideCt(event: H3Event) {
  const ip = event.node.req.socket.remoteAddress ?? ''
  const h = event.node.req.headers
  return (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')
    && !h['x-forwarded-for'] && !h['tailscale-user-login'] && !h['forwarded']
}

/** one owner, so one global counter: 5 misses, then a lockout that doubles each time (30 s … 15 min) */
const guard = { misses: 0, until: 0, lockouts: 0 }
export function lockedFor() { return Math.max(0, Math.ceil((guard.until - Date.now()) / 1000)) }
export function recordAttempt(ok: boolean) {
  if (ok) { Object.assign(guard, { misses: 0, until: 0, lockouts: 0 }); return }
  if (++guard.misses >= 5) {
    guard.misses = 0
    guard.until = Date.now() + Math.min(30_000 * 2 ** guard.lockouts++, 15 * 60_000)
  }
}

/** NUXT_OWNER_LOGINS (comma-separated) — the Tailscale logins allowed past `tailscale serve` */
export function ownerLogin(event: H3Event) {
  const login = String(event.node.req.headers['tailscale-user-login'] ?? '').toLowerCase()
  const allowed = String(useRuntimeConfig(event).ownerLogins || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
  return !!login && allowed.includes(login)
}

/**
 * The home-network door (lan/Caddyfile): Caddy on the CT's LAN IP answers only the LAN subnet (lan.subnet) and stamps each
 * request with NUXT_LAN_KEY. `tailscale serve` passes client headers through, so the key — not the header's
 * presence — is what proves a request took that path.
 */
export function fromLan(event: H3Event) {
  const want = Buffer.from(String(useRuntimeConfig(event).lanKey || ''))
  const got = Buffer.from(String(event.node.req.headers['x-dash-lan'] ?? ''))
  return want.length >= 32 && got.length === want.length && timingSafeEqual(got, want)
}

/** a write's Origin (or Referer, if a browser left Origin out) must be this host */
export function sameOrigin(event: H3Event) {
  const h = event.node.req.headers
  const src = String(h.origin || h.referer || '')
  if (!src) return false
  try { return new URL(src).host === String(h['x-forwarded-host'] || h.host || '') } catch { return false }
}
