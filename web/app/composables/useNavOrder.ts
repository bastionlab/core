/**
 * The order of the sidebar / phone menu pages, one list per kind of device (phone, tablet, desktop), kept in the
 * synced settings (`nav:order:<kind>`). Pages not in the list (new add-ons) follow at the end in their default order.
 * The layout hands in the pages the viewer may open; the Sidebar order add-on's settings card reads them back.
 */
export function useNavOrder<T extends { to: string }>(base?: () => T[]) {
  const kind = deviceKind()
  const items = useState<T[]>('nav:base', () => [])
  if (base) watchEffect(() => { items.value = base() })
  const { value, set } = useSynced<string[]>(`nav:order:${kind}`, () => [])
  const ordered = computed(() => {
    const o = value.value
    if (!o?.length) return items.value
    const rank = (to: string) => { const i = o.indexOf(to); return i < 0 ? 999 : i }
    return items.value.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n.to) - rank(b.n.to) || a.i - b.i).map(x => x.n)
  })
  return { ordered, set, reset: () => set([]), kind, custom: computed(() => !!value.value?.length) }
}
