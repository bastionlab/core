/** registers public/sw.js (falls back to the other address when this one is unreachable) and drops its hop marker */
export default defineNuxtPlugin(() => {
  const url = new URL(location.href)
  if (url.searchParams.has('sw-hop')) {
    url.searchParams.delete('sw-hop')
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  }
  // the worker learns both ways in (tailnet name, LAN IP) from this install's config; before login (no config)
  // an existing registration is left alone. Only phones and tablets hop (they move between Wi-Fi and mobile data);
  // a PC gets an empty list, so its worker just shows notifications and a dead address stays an error.
  const roams = matchMedia('(pointer: coarse)').matches
  $fetch<any>('/api/config').then((c) => {
    const addrs = roams ? [c.tailnet && `https://dash.${c.tailnet}`, c.cts?.dash?.ip && `https://${c.cts.dash.ip}`].filter(Boolean) : []
    return navigator.serviceWorker?.register(`/sw.js?addrs=${encodeURIComponent(JSON.stringify(addrs))}`)
  }).catch(() => {}) // fails on an untrusted cert — install /ca.crt
  // a tapped notification whose window couldn't be navigated by the worker itself
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (typeof e.data?.go === 'string') { const u = new URL(e.data.go); navigateTo(u.pathname + u.search + u.hash) }
  })
})
