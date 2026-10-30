#!/usr/bin/env node
// Replays the demo seeds against the running app: demo/seed.json, then addons/<id>/demo/seed.json (alphabetical).
//   node demo/seed.mjs <base-url> <data-dir> [addon,ids]      see demo/README.md for the format
// A seed is a JSON list. {method, path, body} calls the app's own API (loopback = owner, so writes work);
// {db: "habits.db", sql, params?} runs SQL on one of the app's databases in <data-dir> (for what no API can set, e.g. backdating).
// Strings may hold "$now" "$now_ms" "$iso_now" (whole value), "$ago_ms:<seconds>" (whole value) and "$day:<n>" (YYYY-MM-DD, n days ago, anywhere).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const [base, dataDir, only] = process.argv.slice(2)
if (!base || !dataDir) { console.error('usage: seed.mjs <base-url> <data-dir> [addon,ids]'); process.exit(2) }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const want = only ? new Set(only.split(',').filter(Boolean)) : null
const DAY = 86_400_000

function sub(v) {
  if (typeof v === 'string') {
    if (v === '$now') return Math.floor(Date.now() / 1000)
    if (v === '$now_ms') return Date.now()
    if (v === '$iso_now') return new Date().toISOString()
    const m = /^\$ago_ms:(\d+)$/.exec(v)
    if (m) return Date.now() - +m[1] * 1000
    return v.replace(/\$day:(\d+)/g, (_, n) => new Date(Date.now() - +n * DAY).toISOString().slice(0, 10))
  }
  if (Array.isArray(v)) return v.map(sub)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]))
  return v
}

const files = [join(ROOT, 'demo', 'seed.json')]
const adir = join(ROOT, 'addons')
if (existsSync(adir)) for (const id of readdirSync(adir).sort()) if (!want || want.has(id)) files.push(join(adir, id, 'demo', 'seed.json'))

let ok = 0, failed = 0
for (const f of files.filter(existsSync)) {
  let list
  try { list = JSON.parse(readFileSync(f, 'utf8')) } catch (e) { console.error(`seed: ${f}: ${e.message}`); failed++; continue }
  for (const s of list) {
    try {
      if (s.db) {
        if (!/^[\w.-]+\.db$/.test(s.db)) throw new Error('bad db name')
        const db = new DatabaseSync(resolve(dataDir, s.db))
        try { db.prepare(s.sql).run(...(s.params ?? [])) } finally { db.close() }
      } else {
        const r = await fetch(base + s.path, { method: s.method || 'POST', headers: { 'content-type': 'application/json' }, body: s.body === undefined ? undefined : JSON.stringify(sub(s.body)) })
        if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`)
      }
      ok++
    } catch (e) { failed++; console.error(`seed: ${f.replace(ROOT + '/', '')}: ${s.method ?? 'SQL'} ${s.path ?? s.db}: ${e.message}`) }
  }
}
writeFileSync(join(dataDir, '.seeded'), new Date().toISOString())
console.log(`seeded: ${ok} ok, ${failed} failed`)
