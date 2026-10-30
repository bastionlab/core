#!/usr/bin/env node
// Demo backends: one process that plays the host agent, Ollama, the deals backend and the money backend with
// made-up fixtures, so the dashboard runs on any machine. No dependencies. See demo/README.md.
//   node demo/agent.mjs   (env: DEMO_AGENT_PORT 17070, DEMO_OLLAMA_PORT 11435, DEMO_DEALS_PORT 18090, DEMO_MONEY_PORT 18091,
//                          DEMO_ADDONS=a,b,c to only load those add-ons' fixtures, default all)
import http from 'node:http'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORTS = {
  agent: +(process.env.DEMO_AGENT_PORT || 17070), ollama: +(process.env.DEMO_OLLAMA_PORT || 11435),
  deals: +(process.env.DEMO_DEALS_PORT || 18090), money: +(process.env.DEMO_MONEY_PORT || 18091),
}
const only = process.env.DEMO_ADDONS ? new Set(process.env.DEMO_ADDONS.split(',').filter(Boolean)) : null

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch (e) { if (existsSync(f)) console.error(`demo: ${f}: ${e.message}`); return null } }

/** core demo/fixtures/<service>.json merged with every addons/<id>/demo/<service>.json (later files win per key) */
function load(service) {
  const out = { ...(readJson(join(HERE, 'fixtures', `${service}.json`)) ?? {}) }
  const dir = join(ROOT, 'addons')
  if (existsSync(dir)) {
    for (const id of readdirSync(dir).sort()) {
      if (only && !only.has(id)) continue
      Object.assign(out, readJson(join(dir, id, 'demo', `${service}.json`)) ?? {})
    }
  }
  return out
}

// the marketplace answers come from the add-ons index unless a fixture says otherwise
function fallback(service, key) {
  if (service !== 'agent') return undefined
  if (key === 'GET /marketplace/index') { const i = readJson(join(ROOT, 'addons', 'index.json')); return i ? { ...i, source: 'remote' } : undefined }
  if (key === 'GET /marketplace/local') return {}
  return undefined
}

/** "$now" "$now_ms" "$iso_now" "$today" "$ago:<seconds>" as a whole string value are replaced at serve time */
function fresh(v) {
  if (typeof v === 'string') {
    const now = Math.floor(Date.now() / 1000)
    if (v === '$now') return now
    if (v === '$now_ms') return Date.now()
    if (v === '$iso_now') return new Date().toISOString()
    if (v === '$today') return new Date().toISOString().slice(0, 10)
    const m = /^\$ago:(-?\d+)$/.exec(v)
    return m ? now - +m[1] : v
  }
  if (Array.isArray(v)) return v.map(fresh)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fresh(x)]))
  return v
}

/** exact "METHOD /path", else the longest "METHOD /prefix*" */
function lookup(table, method, path, query = new URLSearchParams()) {
  // "GET /feed?show=rejected": a key with query parts matches when the request has all of them; the most specific wins
  let q = null
  for (const k of Object.keys(table)) {
    const [kp, kq] = k.split('?')
    if (kq === undefined || kp !== `${method} ${path}`) continue
    const want = [...new URLSearchParams(kq)]
    if (want.every(([a, b]) => query.get(a) === b) && (!q || want.length > q.n)) q = { n: want.length, key: k }
  }
  if (q) return { hit: table[q.key], key: q.key }
  const exact = `${method} ${path}`
  if (exact in table) return { hit: table[exact], key: exact }
  let best = null
  for (const k of Object.keys(table)) {
    if (!k.endsWith('*') || !k.startsWith(`${method} `)) continue
    if (exact.startsWith(k.slice(0, -1)) && (!best || k.length > best.length)) best = k
  }
  return best ? { hit: table[best], key: best } : null
}

const SSE = ['/claude/stream', '/term/stream']

function serve(service) {
  return http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0].replace(/(.)\/+$/, '$1')
    req.resume()
    req.on('end', () => {
      const table = load(service) // re-read per request: fixtures can be edited while the demo runs
      const found = lookup(table, req.method, path, new URLSearchParams((req.url || '').split('?')[1] || ''))
      const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(fresh(body))) }
      if (found) return send(200, found.hit)
      const fb = req.method === 'GET' ? fallback(service, `GET ${path}`) : undefined
      if (fb !== undefined) return send(200, fb)
      if (req.method === 'GET' && SSE.some(p => path.startsWith(p))) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        return res.end('event: end\ndata: {}\n\n')
      }
      if (req.method === 'GET' || req.method === 'HEAD') return send(404, { error: 'not found' })
      send(200, { ok: true })
    })
  })
}

for (const [service, port] of Object.entries(PORTS)) {
  serve(service).listen(port, '127.0.0.1', () => console.log(`demo ${service} on 127.0.0.1:${port}`))
}
