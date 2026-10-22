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
const sign = (event: H3Event, iat: number) => createHmac('sha256', key(event)).update(String(iat)).digest('hex')

export const pinConfigured = (event: H3Event) => /^scrypt:[0-9a-f]+:[0-9a-f]+$/.test(pinHash(event))

export function checkPin(event: H3Event, pin: string) {
  const [, salt, hash] = pinHash(event).split(':')
  const want = Buffer.from(hash!, 'hex')
  const got = scryptSync(pin, Buffer.from(salt!, 'hex'), want.length, { N: 16384, r: 8, p: 1 })
  return timingSafeEqual(got, want)
}

export function issueCookie(event: H3Event) {
  const iat = Math.floor(Date.now() / 1000)
  setCookie(event, COOKIE, `${iat}.${sign(event, iat)}`, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' })
}

export function validCookie(event: H3Event) {
  if (!pinConfigured(event)) return false
  const [iat, mac] = String(getCookie(event, COOKIE) ?? '').split('.')
  const t = Number(iat)
  if (!t || !mac || Date.now() / 1000 - t > MAX_AGE) return false
  const want = Buffer.from(sign(event, t)), got = Buffer.from(mac)
  return got.length === want.length && timingSafeEqual(got, want)
}

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

/** a write's Origin (or Referer, if a browser left Origin out) must be this host */
export function sameOrigin(event: H3Event) {
  const h = event.node.req.headers
  const src = String(h.origin || h.referer || '')
  if (!src) return false
  try { return new URL(src).host === String(h['x-forwarded-host'] || h.host || '') } catch { return false }
}
