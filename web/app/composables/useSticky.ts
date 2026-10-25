/** a ref that survives reloads (localStorage, this device only): fold/unfold state and similar view choices */
export function useSticky<T>(key: string, initial: T) {
  const k = `sticky:${key}`
  const v = useState<T>(k, () => {
    try { const s = localStorage.getItem(k); if (s != null) return JSON.parse(s) } catch {}
    return initial
  })
  watch(v, x => { try { localStorage.setItem(k, JSON.stringify(x)) } catch {} }, { deep: true })
  return v
}
