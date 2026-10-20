import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** screenshots pasted into the chat; kept as long as pve keeps the Claude turn they went with (30 days) */
export const CHAT_IMG_DIR = join(process.env.NOTES_DIR || '/var/lib/dash', 'chat-img')
mkdirSync(CHAT_IMG_DIR, { recursive: true })

export function sweepChatImages() {
  for (const f of readdirSync(CHAT_IMG_DIR)) {
    try { if (Date.now() - statSync(join(CHAT_IMG_DIR, f)).mtimeMs > 30 * 86_400_000) unlinkSync(join(CHAT_IMG_DIR, f)) } catch {}
  }
}

/** name → base64, for handing the images to Claude on pve */
export const chatImages = (names: unknown) => (Array.isArray(names) ? names : []).filter(n => imgOk(String(n))).slice(0, 8).map((n) => {
  try { return { name: String(n), data: readFileSync(join(CHAT_IMG_DIR, String(n))).toString('base64') } } catch { return null }
}).filter(Boolean)
