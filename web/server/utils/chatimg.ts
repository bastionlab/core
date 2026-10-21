import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

/** screenshots and files dropped into the chat; kept as long as pve keeps the Claude turn they went with (30 days) */
export const CHAT_IMG_DIR = join(process.env.NOTES_DIR || '/var/lib/dash', 'chat-img')
mkdirSync(CHAT_IMG_DIR, { recursive: true })

export function sweepChatImages() {
  for (const f of readdirSync(CHAT_IMG_DIR)) {
    try { if (Date.now() - statSync(join(CHAT_IMG_DIR, f)).mtimeMs > 30 * 86_400_000) unlinkSync(join(CHAT_IMG_DIR, f)) } catch {}
  }
}

// any other file keeps its own name behind a random prefix: <24 hex>-<name>
const FILE_NAME = /^[a-f0-9]{24}-[\w.-]{1,100}$/
export const chatFileOk = (name: string) => FILE_NAME.test(name) && !name.includes('..')
export const chatAttOk = (name: string) => imgOk(name) || chatFileOk(name)
/** "<hex>-report.pdf" → "report.pdf" */
export const chatFileLabel = (name: string) => name.replace(/^[a-f0-9]{24}-/, '')

export function saveChatFile(data: string, name: string) {
  const buf = Buffer.from(data, 'base64')
  if (!buf.length || buf.length > 20 * 2 ** 20) throw createError({ statusCode: 400, statusMessage: 'file is empty or over 20 MB' })
  const clean = name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[._]+/, '').slice(-100) || 'file'
  const out = `${randomBytes(12).toString('hex')}-${clean}`
  writeFileSync(join(CHAT_IMG_DIR, out), buf)
  return out
}

/** name → base64, for handing the attachments to Claude on pve */
export const chatImages = (names: unknown) => (Array.isArray(names) ? names : []).filter(n => chatAttOk(String(n))).slice(0, 8).map((n) => {
  try { return { name: String(n), data: readFileSync(join(CHAT_IMG_DIR, String(n))).toString('base64') } } catch { return null }
}).filter(Boolean)
