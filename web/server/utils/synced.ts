import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Small per-owner settings every device shares (the Home layout, …): one JSON file in CT 104 next to the chats.
 * Each value carries the client's edit time `upd`; the newer one wins, like chats.
 */
const DIR = process.env.NOTES_DIR || '/var/lib/dash'
const FILE = join(DIR, 'synced.json')
mkdirSync(DIR, { recursive: true })
type Stored = Record<string, { upd: number, value: any }>
const read = (): Stored => { try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return {} } }

export const okSyncKey = (k: any) => typeof k === 'string' && /^[a-z0-9:-]{1,40}$/.test(k)
export const getSynced = (key: string) => read()[key] ?? { upd: 0, value: null }

/** stores it only if it is newer than what is there; returns what is stored afterwards */
export function putSynced(key: string, upd: number, value: any) {
  const all = read()
  if ((all[key]?.upd ?? 0) < upd) {
    all[key] = { upd, value }
    writeFileSync(FILE + '.tmp', JSON.stringify(all))
    renameSync(FILE + '.tmp', FILE)
  }
  return all[key]!
}
