/** which add-ons are switched off (server/utils/addons.ts); loaded once, the Add-ons page updates it */
export function useAddons() {
  const list: Addon[] = [...ADDONS, ...(useRuntimeConfig().public.addons as Addon[] ?? [])]
  const off = useState<string[] | null>('addons:off', () => null)
  // a failed load (not logged in yet) stays null = everything on, and is tried again on the next page
  const load = async () => { const r = await $fetch<{ off: string[] }>('/api/addons').catch(() => null); if (r) off.value = r.off }
  const isOn = (id: string) => !(off.value ?? []).includes(id)
  // the signed-in role (auth.global); unknown yet = show everything, the server says no anyway
  const role = useState<string | null>('auth:role', () => null)
  /** may this role open the page: core pages by CORE_PAGE_ROLES, add-on pages by their `roles.view` */
  const pageAllowed = (path: string) => {
    if (!role.value) return true
    const a = addonOf(list, path)
    return atLeast(role.value, a ? addonRoles(a.roles).view : (CORE_PAGE_ROLES[path] ?? 'owner'))
  }
  /** core pages and pages of add-ons that are on, and that the signed-in role may open */
  const pageOn = (path: string) => { const a = addonOf(list, path); return (!a || isOn(a.id)) && pageAllowed(path) }
  /** optimistic: the tab appears/disappears at once and comes back if the server refuses (the caller shows why) */
  async function set(id: string, on: boolean) {
    const before = off.value
    off.value = on ? (before ?? []).filter(x => x !== id) : [...(before ?? []), id]
    try { off.value = (await $fetch<{ off: string[] }>('/api/addons', { method: 'POST', body: { id, on } })).off }
    catch (e) { off.value = before; throw e }
  }
  return { list, off, load, isOn, pageOn, pageAllowed, role, set }
}
