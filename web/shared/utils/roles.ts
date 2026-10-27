/**
 * Who may do what. Checked on the server (server/middleware/auth.ts, ai/action routes) and used by the UI to hide
 * what a role can't use. Anything not listed needs the owner, so a new route is safe until someone opens it up.
 *
 * owner  — everything: Claude, terminals, add-ons, settings, host power, users
 * admin  — runs the everyday actions (restart a container, back up, …), sees the status pages; no Claude, no root shell
 * member — uses the add-ons opened to members (once they keep data per person) + read-only status
 * viewer — read-only status: Home, Metrics, the add-ons opened to viewers (wall tablet / TV)
 */
export const ROLE_ORDER = ['viewer', 'member', 'admin', 'owner'] as const
export type Role = typeof ROLE_ORDER[number]
export const isRole = (r: any): r is Role => ROLE_ORDER.includes(r)
export const atLeast = (have: string | null | undefined, need: Role) =>
  isRole(have) && ROLE_ORDER.indexOf(have) >= ROLE_ORDER.indexOf(need)

/** an add-on's `roles:` in addon.yaml: who sees its pages / reads its API (view) and who changes things (use) */
export interface AddonRoles { view: Role, use: Role }
export const DEFAULT_ADDON_ROLES: AddonRoles = { view: 'owner', use: 'owner' }
export function addonRoles(r: any): AddonRoles {
  return { view: isRole(r?.view) ? r.view : 'owner', use: isRole(r?.use) ? r.use : 'owner' }
}

/** core API prefixes: [prefix, role to read (GET), role to write]; first match wins, unlisted = owner */
export const CORE_API: [string, Role, Role][] = [
  ['/api/account', 'viewer', 'viewer'],
  ['/api/overview', 'viewer', 'owner'],
  ['/api/net', 'viewer', 'admin'],
  ['/api/config', 'viewer', 'owner'],
  ['/api/locale', 'viewer', 'viewer'],
  ['/api/addons', 'viewer', 'owner'],
  ['/api/synced', 'viewer', 'owner'], // the Home layout is the owner's
  ['/api/ai/action', 'admin', 'admin'], // per action below
  ['/api/ai', 'admin', 'admin'],
]

/** core pages: the minimum role to open them */
export const CORE_PAGE_ROLES: Record<string, Role> = { '/': 'viewer', '/metrics': 'viewer', '/settings': 'viewer', '/addons': 'owner' }

/** actions an admin may run; every other action (add-ons, config, deploy, secrets, host power, apt, dev boxes) is the owner's */
export const ADMIN_ACTIONS = new Set([
  'backup_ct', 'backup_all', 'ct_start', 'ct_shutdown', 'ct_reboot', 'service_restart', 'zfs_scrub',
])
/** add-ons can open more of their own actions to admins with `admin_actions:` in addon.yaml */
export const actionRole = (name: string, extraAdmin: string[] = []): Role =>
  ADMIN_ACTIONS.has(name) || extraAdmin.includes(name) ? 'admin' : 'owner'
