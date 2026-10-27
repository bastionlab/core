/** connection state kept by public/sw.js: live/offline, when data was last fresh, how many edits wait to sync */
export function useOffline() {
  const s = useState('offline', () => ({ state: 'live' as 'live' | 'offline', at: null as number | null, queued: 0, syncing: false, needsLogin: false }))
  /** ask the worker to replay the queued edits now */
  function flush() {
    if (import.meta.client) navigator.serviceWorker?.controller?.postMessage({ flush: true })
  }
  return Object.assign(s, { flush })
}
