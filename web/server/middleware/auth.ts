/**
 * 1. tailnet identity: `tailscale serve` stamps every request from a person's device with Tailscale-User-Login.
 *    Only the owner's login gets in; tagged devices (the other CTs) carry no login and are turned away, so a
 *    compromised service box can't even reach the PIN screen. Commands inside the CT itself still pass, and so
 *    does the home network through Caddy (fromLan) — those still need the PIN like everyone else.
 * 2. every API route needs a session (account or PIN), except the login endpoints themselves, and the role the
 *    route asks for (server/utils/access.ts, shared/utils/roles.ts). Other tailnet people only get to the
 *    sign-in page when the owner allows guests (Settings → Users).
 * 3. writes must come from the dashboard's own origin (SameSite=strict alone lets sibling *.ts.net apps through)
 */
export default defineEventHandler((event) => {
  const inside = fromInsideCt(event)
  event.context.inside = inside
  const guest = tailnetGuests() && !!event.node.req.headers['tailscale-user-login']
  if (!inside && !ownerLogin(event) && !fromLan(event) && !guest) throw createError({ statusCode: 403, statusMessage: 'not on the owner\'s tailnet login' })
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/')) return
  if (event.method !== 'GET' && event.method !== 'HEAD' && !inside && !sameOrigin(event))
    throw createError({ statusCode: 403, statusMessage: 'cross-origin write' })
  if (path.startsWith('/api/auth/')) return
  const sess = session(event)
  if (sess) event.context.uid = sess.uid
  else if (!inside) throw createError({ statusCode: 401, statusMessage: 'locked' })
  const need = roleFor(path, event.method)
  if (!atLeast(roleOf(event), need)) throw createError({ statusCode: 403, statusMessage: `needs the ${need} role` })
})
