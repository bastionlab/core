/** what the page on screen polls: pull-to-refresh (layout) runs all of them at once */
export const pageRefreshers = new Set<() => any>()

/** run fn now and every ms, but only while the tab is visible */
export function usePoll(fn: () => any, ms: number) {
  let timer: any
  const tick = () => { if (!document.hidden) fn() }
  const start = () => { stop(); timer = setInterval(tick, ms) }
  const stop = () => { clearInterval(timer); timer = null }
  const onVis = () => { if (document.hidden) stop(); else { fn(); start() } }
  onMounted(() => { fn(); start(); document.addEventListener('visibilitychange', onVis); window.addEventListener('bastion:synced', fn); pageRefreshers.add(fn) })
  onUnmounted(() => { stop(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('bastion:synced', fn); pageRefreshers.delete(fn) })
  return { refresh: fn, start, stop }
}

/** one shared, pollable GET for the whole app — every page and the header see the same data */
export function useShared<T>(key: string, url: string) {
  const data = useState<T | null>(key, () => null)
  const error = useState<any>(key + ':error', () => null)
  const updated = useState<number>(key + ':at', () => 0)
  const pending = useState<boolean>(key + ':pending', () => false)
  let inflight: Promise<any> | null = null

  const refresh = () => {
    if (inflight) return inflight
    pending.value = true
    inflight = $fetch<T>(url)
      .then((r) => { data.value = r; error.value = null; updated.value = Date.now() })
      .catch((e) => { error.value = e })
      .finally(() => { pending.value = false; inflight = null })
    return inflight
  }
  return { data, error, updated, pending, refresh }
}

export const useOverview = () => useShared<any>('overview', '/api/overview')
export const useMedia = () => useShared<any>('media', '/api/media')
export const useProjects = () => useShared<any[]>('projects', '/api/projects')
export const useDeals = () => useShared<any>('deals', '/api/deals')
export const useFlats = () => useShared<any>('flats', '/api/flats')
export const useJobs = () => useShared<any>('jobs', '/api/jobs')
export const useNotes = () => useShared<{ notes: any[] }>('notes', '/api/notes')
