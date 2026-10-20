import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

/**
 * Notes live in CT 104 itself (StateDirectory=dash → /var/lib/dash), so they ride along in the nightly vzdump.
 * The owner throws in raw text + images; the raw text is kept forever, and the local model rewrites it into
 * `body` in the background. Every AI change keeps the previous body in `prev`, so one click undoes it.
 */
const DIR = process.env.NOTES_DIR || '/var/lib/dash'
export const IMG_DIR = join(DIR, 'notes-img')
mkdirSync(IMG_DIR, { recursive: true })

const db = new DatabaseSync(join(DIR, 'notes.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    raw TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    prev TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    kind TEXT NOT NULL DEFAULT 'note',
    images TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'active',
    job TEXT,
    ai_error TEXT,
    created REAL NOT NULL,
    updated REAL NOT NULL
  );
`)
// tags were too much clutter (2026-10-20): one topic per note instead; the first old tag becomes the topic
try {
  db.exec(`ALTER TABLE notes ADD COLUMN topic TEXT NOT NULL DEFAULT ''`)
  db.exec(`UPDATE notes SET topic = coalesce(json_extract(tags, '$[0]'), '')`)
} catch {}

export const KINDS = ['idea', 'todo', 'note', 'link', 'journal'] as const
export const STATES = ['active', 'done', 'archived'] as const
type Job = { type: 'polish' } | { type: 'merge', text: string, images: string[] } | { type: 'rewrite' } | { type: 'expand' }

const now = () => Date.now() / 1000
const row = (r: any) => r && ({
  id: r.id, raw: r.raw, title: r.title, body: r.body, undo: r.prev != null, topic: r.topic, kind: r.kind,
  images: JSON.parse(r.images), pinned: !!r.pinned, state: r.state, job: r.job ? JSON.parse(r.job).type : null,
  aiError: r.ai_error, created: r.created, updated: r.updated,
})

export const listNotes = () => db.prepare('SELECT * FROM notes ORDER BY id DESC').all().map(row)
export const getNote = (id: number) => row(db.prepare('SELECT * FROM notes WHERE id = ?').get(id))

export function addNote(raw: string, images: string[], ai: boolean) {
  const t = now()
  // until the model has had its go, the raw text is the body, so the note is usable right away
  const title = ai ? '' : raw.split('\n')[0]!.slice(0, 80)
  const { lastInsertRowid } = db.prepare('INSERT INTO notes (raw, title, body, images, job, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(raw, title, raw, JSON.stringify(images), ai ? JSON.stringify({ type: 'polish' }) : null, t, t)
  const id = Number(lastInsertRowid)
  if (ai) enqueue(id)
  return getNote(id)
}

export function editNote(id: number, f: { title?: string, body?: string, topic?: string, kind?: string, pinned?: boolean, state?: string, images?: string[] }) {
  const n = getNote(id)
  if (!n) throw createError({ statusCode: 404, statusMessage: 'no such note' })
  const set: string[] = [], v: any[] = []
  const put = (col: string, val: any) => { set.push(`${col} = ?`); v.push(val) }
  if (f.title != null) put('title', f.title)
  if (f.body != null) put('body', f.body)
  if (f.topic != null) put('topic', f.topic)
  if (f.kind) put('kind', f.kind)
  if (f.pinned != null) put('pinned', f.pinned ? 1 : 0)
  if (f.state) put('state', f.state)
  if (f.images) {
    put('images', JSON.stringify(f.images))
    for (const img of n.images) if (!f.images.includes(img)) dropImage(img)
  }
  // a hand edit of the text makes the last AI version the wrong thing to undo back to
  if (f.body != null || f.title != null) put('prev', null)
  // touching pin/state is housekeeping, not an edit — keep "recently edited" meaningful
  if (f.title != null || f.body != null || f.topic != null || f.kind || f.images) put('updated', now())
  if (set.length) db.prepare(`UPDATE notes SET ${set.join(', ')} WHERE id = ?`).run(...v, id)
  return getNote(id)
}

export function deleteNote(id: number) {
  const n = getNote(id)
  if (!n) return
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
  for (const img of n.images) dropImage(img)
}

/** queue an AI job for a note; the raw text of a merge is saved right away so nothing is lost if the model fails */
export function queueJob(id: number, job: Job) {
  const n = getNote(id)
  if (!n) throw createError({ statusCode: 404, statusMessage: 'no such note' })
  if (n.job) throw createError({ statusCode: 409, statusMessage: 'the AI is still working on this note' })
  if (job.type === 'merge') {
    db.prepare('UPDATE notes SET raw = ?, images = ? WHERE id = ?')
      .run(`${n.raw}\n\n${job.text}`.trim(), JSON.stringify([...n.images, ...job.images]), id)
  }
  db.prepare('UPDATE notes SET job = ?, ai_error = NULL WHERE id = ?').run(JSON.stringify(job), id)
  enqueue(id)
  return getNote(id)
}

export function undoAi(id: number) {
  const r: any = db.prepare('SELECT prev FROM notes WHERE id = ?').get(id)
  if (r?.prev == null) throw createError({ statusCode: 409, statusMessage: 'nothing to undo' })
  const p = JSON.parse(r.prev)
  db.prepare('UPDATE notes SET title = ?, body = ?, topic = ?, kind = ?, prev = NULL, updated = ? WHERE id = ?')
    .run(p.title, p.body, p.topic ?? '', p.kind, now(), id)
  return getNote(id)
}

// ---- images ---------------------------------------------------------------------------------------------

const IMG_NAME = /^[a-f0-9]{24}\.(jpg|png|webp)$/
export const imgOk = (name: string) => IMG_NAME.test(name)

export function saveImage(data: string, type: string, dir = IMG_DIR) {
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[type]
  if (!ext) throw createError({ statusCode: 400, statusMessage: 'only jpeg, png or webp' })
  const buf = Buffer.from(data, 'base64')
  if (!buf.length || buf.length > 8 * 2 ** 20) throw createError({ statusCode: 400, statusMessage: 'image is empty or over 8 MB' })
  const name = `${randomBytes(12).toString('hex')}.${ext}`
  writeFileSync(join(dir, name), buf)
  return name
}

function dropImage(name: string) {
  if (imgOk(name)) try { unlinkSync(join(IMG_DIR, name)) } catch {}
}

/** images pasted into a draft that was never saved: anything unreferenced and older than a day */
function sweepImages() {
  const used = new Set(listNotes().flatMap((n: any) => n.images))
  for (const f of readdirSync(IMG_DIR)) {
    if (!used.has(f) && imgOk(f) && Date.now() - statSync(join(IMG_DIR, f)).mtimeMs > 86_400_000) dropImage(f)
  }
}

// ---- the AI worker --------------------------------------------------------------------------------------

// tuned on qwen3.5:9b against real messy notes (DE + EN). The worked example is English on purpose but the model
// still drifts into the example's language, so the note's language is detected here and stated outright.
const RULES = `You turn a quick, messy note into a clean one. The owner typed it in a hurry; you are their careful secretary.
- Keep the owner's meaning exactly. Keep every idea, fact, name, number and link. Do not reinterpret, generalise or invent anything, and add no advice. If something is unclear, keep their wording.
- Keep the owner's certainty: "glaube ich", "maybe", "??" stay as a hedge ("wohl", "probably", "?"), never become a fact.
- Fix spelling and grammar, expand obvious shorthand (tmrw → tomorrow, vlt → vielleicht), write proper names correctly (BVG, GitHub, Kubernetes, KI).
- Use Markdown. One idea or fact per "- " bullet. Anything the owner needs or wants to do becomes a "- [ ] " checkbox. Use a "## " heading only when the note has several distinct topics. Plain sentences are fine for a short thought or a journal entry.
- Example (format only — the content and language of your answer come from the note):
  Input: "cancel gym by end of month!! and check if urban sports club is worth it, costs like 60€"
  Body:
  - [ ] Cancel the gym by the end of the month
  - [ ] Check whether Urban Sports Club is worth it (costs about 60 €?)
- No intro, no closing remark, do not repeat the title in the body.
- If images are attached, read them: copy the text that matters into the note and say briefly what they show.`

const META = (topics: string[]) => `

Also return:
- title: 2 to 6 words, specific to this note ("Notes tab for the dashboard", not "Idea").
- topic: ONE lowercase word, the area of life or project a person would file this under ("dashboard", "uni", "wohnung", "shopping"), never a generic word like "app", "api", "idea", "todo", "note".${topics.length ? ` Strongly prefer an existing topic when it fits: ${topics.join(', ')}.` : ''}
- kind: "idea" (something to build or try), "todo" (mostly things to do), "link" (mostly about a URL), "journal" (how the day went, feelings), otherwise "note".`

const DE = new Set('und ich nicht das ist für mit auch noch muss soll vlt ob außerdem heute morgen war die der den ein eine sich mal aber wie lief glaube'.split(' '))
const EN = new Set('the and to is for with need also buy looks maybe tomorrow it of i was but my this that'.split(' '))
function lang(t: string) {
  const w = t.toLowerCase().match(/[a-zäöüß]+/g) ?? []
  return w.filter(x => DE.has(x)).length > w.filter(x => EN.has(x)).length ? 'German' : 'English'
}

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' }, body: { type: 'string' },
    topic: { type: 'string' }, kind: { type: 'string', enum: [...KINDS] },
  },
  required: ['title', 'body', 'topic', 'kind'],
}

async function pickModel() {
  const { ollamaUrl } = useRuntimeConfig()
  const ps: any = await $fetch('/api/ps', { baseURL: ollamaUrl, timeout: 10_000 }).catch(() => null)
  const warm = (ps?.models ?? []).find((m: any) => Date.parse(m.expires_at) - Date.now() > 24 * 3600_000 && !/abliterated|uncensored|heretic/i.test(m.name))
  return warm?.name ?? 'qwen3.5:9b'
}

async function chat(messages: any[], format?: any) {
  const { ollamaUrl } = useRuntimeConfig()
  const r: any = await $fetch('/api/chat', {
    baseURL: ollamaUrl, method: 'POST', timeout: 300_000,
    body: { model: await pickModel(), stream: false, think: false, messages, options: { temperature: 0.2 }, ...(format ? { format } : {}) },
  })
  return String(r?.message?.content ?? '')
}

const b64 = (names: string[]) => names.filter(imgOk).slice(-4).map((n) => {
  try { return readFileSync(join(IMG_DIR, n)).toString('base64') } catch { return null }
}).filter(Boolean)

export const cleanTopic = (t: any) => String(t ?? '').toLowerCase().trim().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 32)

async function work(id: number) {
  const r: any = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  if (!r?.job) return
  const job: Job = JSON.parse(r.job)
  const n = row(r)
  const topics = [...new Set(listNotes().map((x: any) => x.topic).filter(Boolean))].slice(0, 60) as string[]
  let out: { title: string, body: string, topic: string, kind: string }

  if (job.type === 'expand') {
    const extra = await chat([
      { role: 'system', content: `The owner wrote down an idea. Make it actionable. Write in ${lang(n.body)}.
Return only markdown to append below the note, nothing else:
## Next steps
3 to 6 concrete "- [ ] " items, the first one doable in under an hour.
## Open questions
up to 4 "- " items the owner has to decide or find out.
Do not repeat or summarise the note. Do not add steps that are already in it.` },
      { role: 'user', content: `# ${n.title}\n\n${n.body}` },
    ])
    out = { title: n.title, body: `${n.body.trimEnd()}\n\n${extra.trim()}`, topic: n.topic, kind: n.kind }
  } else {
    const user = job.type === 'merge'
      ? `Current note (already tidy):\n# ${n.title}\n${n.body}\n\nNew thoughts to merge in — put each where it belongs, keep everything that is already there, drop filler like "ach und", "also", "btw":\n${job.text}`
      : job.type === 'rewrite'
        ? `Tidy up this note again, it may have been edited by hand:\n# ${n.title}\n${n.body}`
        : n.raw
    const imgs = job.type === 'merge' ? job.images : job.type === 'polish' ? n.images : []
    const l = lang(job.type === 'merge' ? `${n.body} ${job.text}` : user)
    const raw = await chat([
      { role: 'system', content: RULES + META(topics) },
      { role: 'user', content: `Note (written in ${l} — answer in ${l}):\n${user || '(only images)'}`, ...(imgs.length ? { images: b64(imgs) } : {}) },
    ], SCHEMA)
    const j = JSON.parse(raw)
    if (!String(j.body ?? '').trim()) throw new Error('the model returned an empty note')
    out = {
      title: String(j.title ?? '').trim().slice(0, 100) || n.title,
      body: String(j.body).trim(),
      topic: cleanTopic(j.topic) || n.topic,
      kind: (KINDS as readonly string[]).includes(j.kind) ? j.kind : n.kind,
    }
    // the owner's own topic/kind survive a merge or rewrite
    if (job.type !== 'polish') out = { ...out, topic: n.topic || out.topic, kind: n.kind }
  }

  // a first polish has nothing worth undoing back to except the raw text, which stays visible as "Original"
  const prev = job.type === 'polish' ? null : JSON.stringify({ title: n.title, body: n.body, topic: n.topic, kind: n.kind })
  db.prepare('UPDATE notes SET title = ?, body = ?, topic = ?, kind = ?, prev = ?, job = NULL, ai_error = NULL, updated = ? WHERE id = ?')
    .run(out.title, out.body, out.topic, out.kind, prev, now(), id)
}

// Ollama runs one request at a time (NUM_PARALLEL=1), so the notes do too
let chain = Promise.resolve()
function enqueue(id: number) {
  chain = chain.then(() => work(id)).catch((e: any) => {
    const msg = String(e?.data?.error || e?.message || e).slice(0, 300)
    // the note keeps whatever text it had; the owner sees the error and can retry
    db.prepare('UPDATE notes SET job = NULL, ai_error = ? WHERE id = ?').run(msg, id)
  })
}

// jobs that were queued when the server stopped
for (const r of db.prepare('SELECT id FROM notes WHERE job IS NOT NULL ORDER BY id').all() as any[]) enqueue(r.id)
try { sweepImages() } catch {}

/** the active notes as text, for the Ask box on the notes page */
export function notesSnapshot(limit = 14_000) {
  const L: string[] = []
  let size = 0
  const notes = listNotes().filter((n: any) => n.state !== 'archived')
    .sort((a: any, b: any) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated)
  for (const n of notes) {
    const s = `### ${n.title || '(untitled)'} [${n.kind}${n.state === 'done' ? ', done' : ''}${n.pinned ? ', pinned' : ''}]${n.topic ? ` topic: ${n.topic}` : ''}\n${new Date(n.created * 1000).toISOString().slice(0, 10)}\n${n.body.slice(0, 1500)}`
    if (size + s.length > limit) { L.push(`… and ${notes.length - L.length} more notes not shown`); break }
    L.push(s); size += s.length
  }
  return `## Notes (${notes.length} not archived)\n\n${L.join('\n\n') || 'no notes yet'}`
}
