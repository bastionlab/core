/** registers public/sw.js (falls back to the other address when this one is unreachable) and drops its hop marker */
export default defineNuxtPlugin(() => {
  const url = new URL(location.href)
  if (url.searchParams.has('sw-hop')) {
    url.searchParams.delete('sw-hop')
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  }
  navigator.serviceWorker?.register('/sw.js').catch(() => {}) // fails on an untrusted cert — install /ca.crt
})
