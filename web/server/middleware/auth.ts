/**
 * 1. tailnet identity: `tailscale serve` stamps every request from a person's device with Tailscale-User-Login.
 *    Only the owner's login gets in; tagged devices (the other CTs) carry no login and are turned away, so a
 *    compromised service box can't even reach the PIN screen. Commands inside the CT itself still pass.
 * 2. every API route needs the PIN cookie, except the login endpoints themselves
 * 3. writes must come from the dashboard's own origin (SameSite=strict alone lets sibling *.ts.net apps through)
 */
export default defineEventHandler((event) => {
  const inside = fromInsideCt(event)
  if (!inside && !ownerLogin(event)) throw createError({ statusCode: 403, statusMessage: 'not on the owner\'s tailnet login' })
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/')) return
  if (event.method !== 'GET' && event.method !== 'HEAD' && !inside && !sameOrigin(event))
    throw createError({ statusCode: 403, statusMessage: 'cross-origin write' })
  if (path.startsWith('/api/auth/')) return
  if (validCookie(event) || inside) return
  throw createError({ statusCode: 401, statusMessage: 'locked' })
})
