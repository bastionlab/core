import type { H3Event } from 'h3'

/**
 * Roles on the server (rules: shared/utils/roles.ts). A PIN unlock and commands inside the CT are the owner;
 * an account is its stored role.
 */
export function roleOf(event: H3Event): Role | null {
  if (event.context.inside) return 'owner'
  const uid = event.context.uid
  if (uid === undefined) return null
  if (!uid) return 'owner' // PIN unlock before any account exists
  const r = userById(uid)?.role
  return isRole(r) ? r : null
}

/** the role a request needs: the core table, then the add-on whose API it hits, else the owner */
export function roleFor(path: string, method: string): Role {
  const read = method === 'GET' || method === 'HEAD'
  const hit = (p: string) => path === p || path.startsWith(p + '/')
  for (const [p, r, w] of CORE_API) if (hit(p)) return read ? r : w
  for (const a of allAddons()) {
    if ((a.api ?? []).some(hit)) { const r = addonRoles(a.roles); return read ? r.view : r.use }
  }
  return 'owner'
}

/** what an action needs: admin for the everyday ones and those an add-on opens up (`admin_actions:`), else owner */
export const roleForAction = (name: string) => actionRole(name, allAddons().flatMap(a => a.adminActions ?? []))

export function requireRole(event: H3Event, need: Role) {
  if (!atLeast(roleOf(event), need)) throw createError({ statusCode: 403, statusMessage: `needs the ${need} role` })
}

/** Settings → Users: let tailnet people other than the owner logins reach the sign-in page (they still need an account) */
export const tailnetGuests = () => metaGet('tailnet_guests') === '1'
