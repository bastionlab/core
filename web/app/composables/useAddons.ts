/** which add-ons are switched off (server/utils/addons.ts); loaded once, the Add-ons page updates it */
export function useAddons() {
  const list: Addon[] = [...ADDONS, ...(useRuntimeConfig().public.addons as Addon[] ?? [])]
  const off = useState<string[] | null>('addons:off', () => null)
  // a failed load (not logged in yet) stays null = everything on, and is tried again on the next page
  const load = async () => { const r = await $fetch<{ off: string[] }>('/api/addons').catch(() => null); if (r) off.value = r.off }
  const isOn = (id: string) => !(off.value ?? []).includes(id)
  /** core pages and pages of add-ons that are on */
  const pageOn = (path: string) => { const a = addonOf(list, path); return !a || isOn(a.id) }
  async function set(id: string, on: boolean) {
    off.value = (await $fetch<{ off: string[] }>('/api/addons', { method: 'POST', body: { id, on } })).off
  }
  return { list, off, load, isOn, pageOn, set }
}
