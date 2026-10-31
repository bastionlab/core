/**
 * The phone tab bar's pinned pages: up to four, the viewer's choice, kept in localStorage (`nav:pinned`).
 * Shared by the stock layout and every skin's Nav, so a pick made in one look holds in all of them.
 * `nav` = the pages the viewer may open, in nav order (the Nav prop); pins of switched-off add-ons are kept.
 */
export const MAX_PINS = 4
const KEY = 'nav:pinned'
const DEFAULT = ['/', '/media', '/dev', '/deals']

export function useNavPins<T extends { to: string }>(nav: () => T[]) {
  const keys = useState<string[]>('nav:pinned', () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (Array.isArray(v)) { const ok = v.filter(x => typeof x === 'string').slice(0, MAX_PINS); if (ok.length) return ok }
    } catch {}
    return DEFAULT
  })
  const editing = useState('nav:pin-edit', () => false)
  const isPinned = (to: string) => keys.value.includes(to)
  /** the pinned pages that are on, as nav entries (with icon/label), in nav order */
  const pinned = computed(() => nav().filter(n => keys.value.includes(n.to)))
  const full = computed(() => keys.value.length >= MAX_PINS)
  function toggle(to: string) {
    const p = keys.value
    if (p.includes(to)) { if (p.length > 1) keys.value = p.filter(x => x !== to) }
    else if (p.length < MAX_PINS) {
      // keep nav order, so the bar reads like the sidebar
      const order = nav().map(n => n.to)
      keys.value = [...p, to].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    }
    try { localStorage.setItem(KEY, JSON.stringify(keys.value)) } catch {}
  }
  return { keys, pinned, isPinned, toggle, editing, full, max: MAX_PINS }
}
