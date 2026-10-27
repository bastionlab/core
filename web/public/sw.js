// sw.js — one home-screen icon for both ways in. The dashboard lives at two addresses: the tailnet name (needs
// Tailscale) and the LAN IP (needs the home Wi-Fi, lan/Caddyfile). When a page load can't reach this one, this
// worker answers with a hop to the other, keeping the path. `?sw-hop` marks a hop, so if both are down it stops
// with a note instead of bouncing back and forth. Only page loads are touched; API calls go straight through.
// It also shows push notifications (agent/push.py, Settings → Notifications); a tap opens the page they're about.
// The two addresses come from this install's config: the plugin registers `/sw.js?addrs=<json list>`.
const ADDRS = (() => { try { return JSON.parse(new URL(self.location.href).searchParams.get('addrs') || '[]') } catch { return [] } })()
const other = ADDRS.find(a => new URL(a).host !== self.location.host)
const TIMEOUT = 3000

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

const page = body => new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><title>Bastion</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;text-align:center">${body}</body>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.mode !== 'navigate' || req.method !== 'GET' || !other) return
  e.respondWith((async () => {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), TIMEOUT)
      try { return await fetch(req, { signal: ctl.signal }) } finally { clearTimeout(t) }
    } catch {
      const url = new URL(req.url)
      if (url.searchParams.has('sw-hop')) {
        return page(`<div>Neither address answers.<br><small>Not on the home Wi-Fi and Tailscale is off?</small><br><br>
<a href="${url.pathname}">Try again</a></div>`)
      }
      url.searchParams.set('sw-hop', '1')
      const to = other + url.pathname + url.search
      return page(`<div>Switching to ${new URL(other).host}…</div><script>location.replace(${JSON.stringify(to)})</script>`)
    }
  })())
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: e.data ? e.data.text() : 'Bastion' } }
  e.waitUntil((async () => {
    // "Claude is done" while the dashboard is on screen: the page shows it already (Chrome allows skipping then)
    if (d.topic === 'chat') {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (wins.some(w => w.visibilityState === 'visible')) return
    }
    await self.registration.showNotification(d.title || 'Bastion', {
      body: d.body || '', tag: d.tag, data: { url: d.url || '/' }, renotify: !!d.tag,
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const w = wins.find(c => new URL(c.url).origin === self.location.origin)
    if (w) { await w.focus(); return w.navigate(url).catch(() => w.postMessage({ go: url })) }
    return self.clients.openWindow(url)
  })())
})
