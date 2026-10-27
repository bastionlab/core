/** wires public/sw.js offline messages into useOffline, syncs queued edits on reconnect and pre-caches route chunks */
export default defineNuxtPlugin(() => {
  const sw = navigator.serviceWorker
  if (!sw) return
  const off = useOffline()
  const { toast } = useToast()
  performance.setResourceTimingBufferSize?.(1000)
  const ask = () => sw.controller?.postMessage({ offlineStatus: true })
  const sync = () => { off.flush(); ask() }

  sw.addEventListener('message', (e) => {
    const m = e.data?.offline
    if (!m) return
    const firstLoginAsk = m.needsLogin && !off.value.needsLogin // toast once per episode
    off.value = { state: m.state, at: m.at ?? off.value.at, queued: m.queued || 0, syncing: m.state === 'live' && m.queued > 0, needsLogin: !!m.needsLogin }
    if (m.flushed > 0) toast(`Synced ${m.flushed} offline change${m.flushed > 1 ? 's' : ''}`, { tone: 'ok' })
    if (m.failed?.length) toast(`${m.failed.length} offline change${m.failed.length > 1 ? 's' : ''} failed`, { tone: 'bad' })
    if (m.flushed > 0 || m.failed?.length) { refreshNuxtData(); window.dispatchEvent(new Event('bastion:synced')) }
    if (firstLoginAsk) toast(`Log in to sync ${m.queued} offline change${m.queued > 1 ? 's' : ''}`, { tone: 'warn' })
  })
  window.addEventListener('offline', () => { off.value = { ...off.value, state: 'offline' } })
  window.addEventListener('online', sync)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync() })
  sw.ready.then(sync).catch(() => {})
  if (!navigator.onLine) off.value = { ...off.value, state: 'offline' }

  // download every route chunk once per build (through the worker, which caches them) so pages open offline
  const warm = async () => {
    const id = useRuntimeConfig().app.buildId
    if (!navigator.onLine || localStorage.getItem('offline:warmed') === id) return
    let clean = true
    for (const r of useRouter().getRoutes()) {
      for (const c of Object.values(r.components || {}) as any[]) {
        if (typeof c === 'function') await c().catch(() => { clean = false })
      }
    }
    if (!clean) return
    localStorage.setItem('offline:warmed', id)
    // every chunk of this build is cached: tell the worker which files are current so it can drop older builds
    const res = performance.getEntriesByType('resource').map(e => e.name)
    if (res.length >= 240) return // timing buffer full: the list may be incomplete
    const doc = [...document.querySelectorAll('script[src],link[href]')].map(e => (e as any).src || (e as any).href)
    const keep = [...new Set([...res, ...doc])].filter(u => { try { const x = new URL(u); return x.origin === location.origin && x.pathname.startsWith('/_nuxt/') } catch { return false } })
    sw.controller?.postMessage({ keepAssets: keep })
  }
  const idle = (window as any).requestIdleCallback as undefined | ((f: () => void) => void)
  if (idle) idle(() => { warm() }); else setTimeout(warm, 5000)
})
