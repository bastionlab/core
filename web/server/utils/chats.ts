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

/** only lands if it is newer than what is stored, and never resurrects a deleted chat */
export function putChat(id: string, upd: number, data: string) {
  const cur = db.prepare('SELECT upd, gone FROM chats WHERE id = ?').get(id) as any
  if (cur && (cur.gone || cur.upd >= upd)) return false
  db.prepare('INSERT INTO chats (id, data, upd, seq) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, upd = excluded.upd, seq = excluded.seq')
    .run(id, data, upd, nextSeq())
  return true
}

export function dropChat(id: string) {
  db.prepare(`INSERT INTO chats (id, data, upd, seq, gone) VALUES (?, NULL, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET data = NULL, gone = 1, seq = excluded.seq`).run(id, Date.now(), nextSeq())
}

/** every live chat's JSON in one string: lets the attachment sweep keep files an old chat still shows */
export const liveChatsText = () => (db.prepare('SELECT data FROM chats WHERE gone = 0').all() as any[]).map(r => r.data).join('\n')
