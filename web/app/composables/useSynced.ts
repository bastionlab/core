/**
 * A setting shared by every device (server/utils/synced.ts): localStorage is the cache that makes the page open
 * instantly, the server copy wins when it is newer. Pulled again whenever the tab comes back into view.
 */
export function useSynced<T>(key: string, fallback: () => T) {
  const LS = `synced:${key}`
  const state = useState<{ upd: number, value: T }>(`synced:${key}`, () => {
    try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (v && 'value' in v) return v } catch {}
    return { upd: 0, value: fallback() }
  })
  const cache = () => { try { localStorage.setItem(LS, JSON.stringify(state.value)) } catch {} }
  async function pull() {
    const r = await $fetch<{ upd: number, value: T }>(`/api/synced/${key}`).catch(() => null)
    if (r && r.value != null && r.upd > state.value.upd) { state.value = r; cache() }
    else if (r && state.value.upd > r.upd) push() // edited offline: send it up now
  }
  async function push() {
    const r = await $fetch<{ upd: number, value: T }>(`/api/synced/${key}`, { method: 'POST', body: state.value }).catch(() => null)
    if (r && r.upd > state.value.upd) { state.value = r; cache() }
  }
  function set(value: T) { state.value = { upd: Date.now(), value }; cache(); push() }
  const onVis = () => { if (!document.hidden) pull() }
  onMounted(() => { pull(); document.addEventListener('visibilitychange', onVis) })
  onUnmounted(() => document.removeEventListener('visibilitychange', onVis))
  return { value: computed(() => state.value.value), set, pull }
}
