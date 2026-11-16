import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Chat conversations, shared by every device (2026-10-21; before that each browser kept its own in localStorage).
 * A chat is one opaque JSON blob; `upd` is the client's edit time (newer wins), `seq` a server counter so a device
 * can ask for "everything since I last looked". Deleted chats stay as tombstones so a stale device can't bring them back.
 */
const DIR = process.env.NOTES_DIR || '/var/lib/dash'
mkdirSync(DIR, { recursive: true })
const db = new DatabaseSync(join(DIR, 'chats.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    data TEXT,
    upd INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    gone INTEGER NOT NULL DEFAULT 0
  );
`)
const nextSeq = () => ((db.prepare('SELECT max(seq) AS m FROM chats').get() as any)?.m ?? 0) + 1
export const chatSeq = () => nextSeq() - 1

export function chatsSince(since: number) {
  const rows = db.prepare('SELECT id, data, upd, gone FROM chats WHERE seq > ? ORDER BY seq').all(since) as any[]
  return {
    seq: chatSeq(),
    chats: rows.filter(r => !r.gone).map(r => ({ ...JSON.parse(r.data), upd: r.upd })),
    gone: rows.filter(r => r.gone).map(r => r.id as string),
  }
}

export function chatsByIds(ids: string[]) {
  const rows = ids.length ? db.prepare(`SELECT id, data, upd, gone FROM chats WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as any[] : []
  return {
    seq: chatSeq(),
    chats: rows.filter(r => !r.gone).map(r => ({ ...JSON.parse(r.data), upd: r.upd })),
    gone: rows.filter(r => r.gone).map(r => r.id as string),
  }
}

/** a turn's identity: its id, or (old turns) the same fallback the app computes */
const turnKey = (t: any) => t?.id || `l${t?.at ?? 0}-${t?.q?.length ?? 0}`

/** union of two turn lists by id; on a clash the longer answer wins (stored copy on a tie); ordered by time */
function mergeTurns(stored: any[], incoming: any[], preferIncoming = false) {
  const m = new Map<string, any>()
  for (const t of [...stored, ...incoming]) {
    const k = turnKey(t), old = m.get(k)
    if (!old || (preferIncoming && incoming.includes(t)) || (t.a?.length ?? 0) + (t.r?.length ?? 0) > (old.a?.length ?? 0) + (old.r?.length ?? 0)) m.set(k, { ...t, id: t.id || k })
  }
  return [...m.values()].map((t, i) => ({ t, i })).sort((x, y) => (x.t.at ?? 0) - (y.t.at ?? 0) || x.i - y.i).map(x => x.t)
}

/** only lands if it is newer than what is stored, and never resurrects a deleted chat; an older or equal edit is merged turn by turn instead of dropped */
export type PutResult = { ok: true } | { ok: false, reason: 'size' | 'tombstone' | 'stale' }
export function putChat(id: string, upd: number, data: string): PutResult {
  const cur = db.prepare('SELECT data, upd, gone FROM chats WHERE id = ?').get(id) as any
  if (cur?.gone) return { ok: false, reason: 'tombstone' }
  if (cur && cur.upd >= upd) {
    try {
      const have = JSON.parse(cur.data), inc = JSON.parse(data)
      if (!Array.isArray(have.turns) || !Array.isArray(inc.turns)) return { ok: false, reason: 'stale' }
      const turns = mergeTurns(have.turns, inc.turns)
      if (JSON.stringify(turns) === JSON.stringify(have.turns)) return { ok: false, reason: 'stale' }
      db.prepare('UPDATE chats SET data = ?, upd = ?, seq = ? WHERE id = ?').run(JSON.stringify({ ...have, turns }), cur.upd + 1, nextSeq(), id)
      return { ok: true }
    } catch { return { ok: false, reason: 'stale' } }
  }
  if (cur?.data) {
    // newer edit: take it, but keep turns another device added meanwhile
    try {
      const have = JSON.parse(cur.data), inc = JSON.parse(data)
      if (Array.isArray(have.turns) && Array.isArray(inc.turns)) data = JSON.stringify({ ...inc, turns: mergeTurns(have.turns, inc.turns, true) })
    } catch { /* unreadable stored copy: the newer one replaces it */ }
  }
  db.prepare('INSERT INTO chats (id, data, upd, seq) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, upd = excluded.upd, seq = excluded.seq')
    .run(id, data, upd, nextSeq())
  return { ok: true }
}

export function dropChat(id: string) {
  db.prepare(`INSERT INTO chats (id, data, upd, seq, gone) VALUES (?, NULL, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET data = NULL, gone = 1, seq = excluded.seq`).run(id, Date.now(), nextSeq())
}

/** every live chat's JSON in one string: lets the attachment sweep keep files an old chat still shows */
export const liveChatsText = () => (db.prepare('SELECT data FROM chats WHERE gone = 0').all() as any[]).map(r => r.data).join('\n')

/** one live chat as stored (without upd), or null: scheduled chat tasks append their runs to it */
export function chatById(id: string): any | null {
  const r = db.prepare('SELECT data FROM chats WHERE id = ? AND gone = 0').get(id) as any
  return r?.data ? JSON.parse(r.data) : null
}
