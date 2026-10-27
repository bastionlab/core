// sw.js — one home-screen icon for both ways in, plus offline mode. The dashboard lives at two addresses: the
// tailnet name (needs Tailscale) and the LAN IP (needs the home Wi-Fi, lan/Caddyfile). When a page load can't reach
// this one, this worker answers with a hop to the other, keeping the path. `?sw-hop` marks a hop, so if both are
// down it stops with a note instead of bouncing back and forth.
// Offline: /_nuxt assets are cache-first, the last good page shell opens without a connection, and /api GETs fall
// back to their last answer (header x-sw-cached). A small allowlist of local data writes (notes, habits, kanji,
// chats, designs, …) is queued in IndexedDB while offline and replayed oldest first when the connection is back;
// everything else (host actions, Claude, external services) is never queued. Pages learn the state by message.
// It also shows push notifications (agent/push.py, Settings → Notifications); a tap opens the page they're about.
// The two addresses come from this install's config: the plugin registers `/sw.js?addrs=<json list>`.
const ADDRS = (() => { try { return JSON.parse(new URL(self.location.href).searchParams.get('addrs') || '[]') } catch { return [] } })()
const other = ADDRS.find(a => new URL(a).host !== self.location.host)
const TIMEOUT = 3000
const SHELL = 'bastion-shell-v2'
const API = 'bastion-api-v2'
const API_TIMEOUT = 8000
const MAX_BODY = 20 * 1024 * 1024
// secrets, per-session, live or big: never cached
const NO_CACHE = ['/api/auth/', '/api/account', '/api/users', '/api/settings', '/api/shares', '/api/backup/', '/api/claude/',
  '/api/term/', '/api/retro/file', '/api/retro/play', '/api/chat/speak', '/api/core/channel']
// pure local data writes that may wait in the queue
function queueable(method, p) {
  if (method === 'POST') {
    return ['/api/notes/action', '/api/kanji/action', '/api/chats', '/api/learn/action', '/api/locale'].includes(p)
      || p.startsWith('/api/habits/') || p.startsWith('/api/synced/')
  }
  return (method === 'PUT' || method === 'PATCH') && (p.startsWith('/api/habits/') || p.startsWith('/api/synced/'))
}
// fetch that gives up after ms (only waiting for the headers, so streams may run on): abort = network error
async function fetchT(req, ms, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try { return await fetch(req, { ...init, signal: ctl.signal }) } finally { clearTimeout(t) }
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('bastion-') && k !== SHELL && k !== API) await caches.delete(k)
  await self.clients.claim()
})()))

const page = body => new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><title>Bastion</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;text-align:center">${body}</body>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })

// --- offline queue (IndexedDB bastion-offline / queue) ---
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('bastion-offline', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true })
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
async function tx(mode, fn) {
  const db = await idb()
  return new Promise((res, rej) => {
    const t = db.transaction('queue', mode)
    const r = fn(t.objectStore('queue'))
    t.oncomplete = () => { db.close(); res(r.result) }
    t.onerror = t.onabort = () => { db.close(); rej(t.error) }
  })
}
const qAdd = item => tx('readwrite', s => s.add(item))
const qAll = () => tx('readonly', s => s.getAll())
const qDel = id => tx('readwrite', s => s.delete(id))
const qCount = () => tx('readonly', s => s.count())
const qClear = () => tx('readwrite', s => s.clear())

// --- state -> pages ---
let last = null // 'live' | 'offline'
let lastLive = 0
let needsLogin = false // a flush hit 401: wait for a login before replaying again
async function tell(extra = {}, force = false) {
  const queued = await qCount().catch(() => 0)
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const w of wins) w.postMessage({ offline: { state: last || 'live', at: lastLive || undefined, queued, needsLogin, ...extra } })
  return queued
}
async function setState(s, at) {
  if (s === 'live') lastLive = Date.now()
  else if (!lastLive && at) lastLive = at
  if (s === last) return
  last = s
  await tell()
}

const json = (obj, status, statusText) => new Response(JSON.stringify(obj), { status, statusText, headers: { 'content-type': 'application/json' } })
const offline503 = () => json({ statusMessage: 'offline', offline: true }, 503, 'offline')

let flushing = false
let flushTimer
async function flush() {
  if (flushing || needsLogin) return
  flushing = true
  let done = 0
  const failed = []
  try {
    for (const it of await qAll()) {
      let r
      try {
        r = await fetch(it.url, { method: it.method, headers: it.contentType ? { 'content-type': it.contentType } : {}, body: it.body, credentials: 'same-origin' })
      } catch { await setState('offline'); break }
      if (r.status === 401) { needsLogin = true; break }
      if (r.status >= 500 || r.status === 408 || r.status === 429) break // server not ready: keep it, try later
      await qDel(it.id)
      if (r.status >= 400) failed.push({ url: new URL(it.url).pathname, status: r.status })
      else done++
      await setState('live')
    }
  } finally { flushing = false }
  if (done || failed.length || needsLogin) await tell({ flushed: done, failed })
}
const flushSoon = () => {
  if (needsLogin) return clearTimeout(flushTimer); flushTimer = setTimeout(() => flush().catch(() => {}), 2000) }

async function enqueue(req) {
  const body = await req.blob()
  if (body.size > MAX_BODY) return offline503()
  await qAdd({ url: req.url, method: req.method, contentType: req.headers.get('content-type') || '', body, at: Date.now() })
  try { await self.registration.sync?.register('bastion-queue') } catch { /* no background sync */ }
  await setState('offline')
  await tell()
  return json({ ok: true, queued: true, offline: true }, 202)
}

async function apiGet(e, req, path) {
  const cache = await caches.open(API)
  let r
  try { r = await fetchT(req, API_TIMEOUT) } catch {
    const hit = await cache.match(req.url)
    if (!hit) { await setState('offline'); return offline503() }
    const at = hit.headers.get('x-sw-at')
    await setState('offline', at ? Number(at) : 0)
    const h = new Headers(hit.headers)
    h.set('x-sw-cached', at || '0')
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: h })
  }
  await setState('live')
  if (r.status === 401) e.waitUntil(caches.delete(API)) // session over: nothing of it may be shown to the next login
  const ok = !NO_CACHE.some(x => path.startsWith(x)) || path === '/api/auth/status' // status holds no secrets; the app shell needs it offline
  if (r.status === 200 && ok && !(r.headers.get('content-type') || '').includes('text/event-stream')) {
    const copy = r.clone()
    e.waitUntil((async () => {
      const h = new Headers(copy.headers)
      h.set('x-sw-at', String(Date.now()))
      await cache.put(req.url, new Response(await copy.blob(), { status: 200, statusText: copy.statusText, headers: h }))
    })().catch(() => {}))
  }
  if (await qCount().catch(() => 0)) flushSoon()
  return r
}

async function navigate(req) {
  const shell = await caches.open(SHELL)
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), TIMEOUT)
    let r
    try { r = await fetch(req, { signal: ctl.signal }) } finally { clearTimeout(t) }
    if (r.ok && (r.headers.get('content-type') || '').includes('text/html')) shell.put('/', r.clone()).catch(() => {})
    return r
  } catch {
    const url = new URL(req.url)
    // hop only when the other address really answers; otherwise the cached shell opens the app offline
    const reach = other && !url.searchParams.has('sw-hop') && await fetchT(other + '/sw.js', 2500, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false)
    if (reach) {
      url.searchParams.set('sw-hop', '1')
      const to = other + url.pathname + url.search
      return page(`<div>Switching to ${new URL(other).host}…</div><script>location.replace(${JSON.stringify(to)})</script>`)
    }
    const hit = await shell.match('/')
    if (hit) return hit
    return page(`<div>Neither address answers.<br><small>Not on the home Wi-Fi and Tailscale is off?</small><br><br>
<a href="${url.pathname}">Try again</a></div>`)
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.headers.has('range')) return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const p = url.pathname
  if (req.mode === 'navigate' && req.method === 'GET') return e.respondWith(navigate(req))
  if (req.method === 'GET' && p.startsWith('/_nuxt/')) {
    const builds = p.startsWith('/_nuxt/builds/') // build id / meta change per release: network first
    return e.respondWith((async () => {
      const cache = await caches.open(SHELL)
      const hit = builds ? null : await cache.match(req)
      if (hit) return hit
      let r
      try { r = await fetch(req) } catch {
        const old = builds && await cache.match(req)
        if (old) return old
        throw new Error('offline')
      }
      if (r.ok) e.waitUntil(cache.put(req, r.clone()).catch(() => {}))
      return r
    })())
  }
  if (!p.startsWith('/api/')) return
  if (req.method === 'GET') return e.respondWith(apiGet(e, req, p))
  if (req.method === 'POST' && p === '/api/auth/logout') {
    return e.respondWith((async () => {
      const r = await fetch(req)
      if (r.ok) { await caches.delete(API); await qClear().catch(() => {}); await tell() } // the next user must not see or send this one's data
      return r
    })())
  }
  if (req.method === 'POST' && ['/api/auth/login', '/api/auth/passkey', '/api/auth/invite'].includes(p)) {
    return e.respondWith((async () => {
      const r = await fetch(req)
      if (r.ok) { await caches.delete(API); needsLogin = false; await tell(); flushSoon() }
      return r
    })())
  }
  if (!queueable(req.method, p)) return
  e.respondWith((async () => {
    if (await qCount().catch(() => 0)) return enqueue(req)
    try {
      const r = await fetchT(req.clone(), API_TIMEOUT)
      if (r.status === 401) e.waitUntil(caches.delete(API))
      return r
    } catch { return enqueue(req) }
  })())
})

self.addEventListener('sync', (e) => { if (e.tag === 'bastion-queue') e.waitUntil(flush()) })
self.addEventListener('message', (e) => {
  if (e.data?.flush) e.waitUntil(flush().then(() => tell()))
  else if (e.data?.offlineStatus) e.waitUntil(tell())
  else if (Array.isArray(e.data?.keepAssets)) {
    // old build files go once the page has loaded every chunk of the current build
    const keep = new Set(e.data.keepAssets.map(u => { try { return new URL(u, self.location.origin).pathname } catch { return u } }))
    e.waitUntil((async () => {
      const cache = await caches.open(SHELL)
      for (const r of await cache.keys()) {
        const p = new URL(r.url).pathname
        if (p.startsWith('/_nuxt/') && !p.startsWith('/_nuxt/builds/') && !keep.has(p)) await cache.delete(r)
      }
    })())
  }
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
