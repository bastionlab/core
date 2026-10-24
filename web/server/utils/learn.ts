import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

/**
 * The Learn tab (2026-10-24): every Monday at noon Claude writes a one-hour tech lesson (reading, a quiz, hands-on
 * tasks), and the lessons pile up into a library. Next to it lives the owner's skillset: seeded from the CV + homelab,
 * and after each finished lesson Claude moves the skills that lesson touched. The library lives here in CT 104 so it rides along in the nightly vzdump;
 * the writing happens on pve (agent /learn/start runs a tool-less `claude -p` with LESSON_SCHEMA) and this side asks
 * once a minute whether it is done.
 *
 * status: queued (on the owner's "up next" list) → pending (write as soon as nothing else is) → writing → ready | failed
 * skills_state (per lesson, once finished): pending → writing → done | failed
 */
const DIR = process.env.NOTES_DIR || '/var/lib/dash'
const db = new DatabaseSync(join(DIR, 'learn.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY,
    day TEXT,
    topic TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    job TEXT,
    error TEXT,
    data TEXT,
    progress TEXT NOT NULL DEFAULT '{}',
    done REAL,
    secs INTEGER,
    created REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    area TEXT NOT NULL,
    level INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    updated REAL NOT NULL
  );
`)
// daily → weekly (2026-10-24): the server is mostly off at 05:00. `week` = the Monday an automatic lesson belongs to
let migrated = false
for (const col of ['week TEXT', 'skills_state TEXT', 'skills_job TEXT']) try { db.exec(`ALTER TABLE lessons ADD COLUMN ${col}`); migrated = true } catch {}

export const TRACKS = ['languages', 'concepts', 'cloud', 'devops', 'systems', 'networking', 'security', 'data', 'web', 'ai'] as const
const WEEKLY_HOUR = 12 // Monday, Berlin time: the server is usually on by then; if not, the first tick after that catches up
export const LEVELS = ['', 'aware', 'basics', 'working', 'strong', 'expert'] as const

const now = () => Date.now() / 1000
export const berlinDay = (t = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(t)
const berlinHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).format(Date.now()))
const berlinWeekday = () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(Date.now()))
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
/** the Monday whose noon slot is the latest one that has begun (before Monday noon that is last week's) */
export function lessonWeek() {
  const wd = berlinWeekday()
  const back = wd === 0 && berlinHour() < WEEKLY_HOUR ? 7 : wd
  return addDays(berlinDay(), -back)
}
/** when the next automatic lesson is due */
export const nextWeek = () => addDays(lessonWeek(), 7)

const row = (r: any) => r && ({
  id: r.id, day: r.day, week: r.week, topic: r.topic, status: r.status, error: r.error, done: r.done, secs: r.secs, created: r.created,
  skills: r.skills_state,
  progress: JSON.parse(r.progress), lesson: r.data ? JSON.parse(r.data) : null,
})
export const listLessons = () => (db.prepare('SELECT * FROM lessons ORDER BY id DESC').all() as any[]).map(row)
export const getLesson = (id: number) => row(db.prepare('SELECT * FROM lessons WHERE id = ?').get(id))
const must = (id: number) => getLesson(id) ?? (() => { throw createError({ statusCode: 404, statusMessage: 'no such lesson' }) })()

export function queueTopic(topic: string, now_: boolean) {
  const { lastInsertRowid } = db.prepare('INSERT INTO lessons (topic, status, day, created) VALUES (?, ?, ?, ?)')
    .run(topic, now_ ? 'pending' : 'queued', now_ ? berlinDay() : null, now())
  if (now_) tick()
  return getLesson(Number(lastInsertRowid))
}

/** a queued topic jumps the line, a failed lesson gets another go */
export function writeNow(id: number) {
  const l = must(id)
  if (l.status !== 'queued' && l.status !== 'failed') throw createError({ statusCode: 409, statusMessage: `lesson is ${l.status}` })
  db.prepare('UPDATE lessons SET status = \'pending\', error = NULL, day = coalesce(day, ?) WHERE id = ?').run(berlinDay(), id)
  tick()
  return getLesson(id)
}

export function saveProgress(id: number, p: { read?: number[], quiz?: Record<string, number>, tasks?: number[] }) {
  const l = must(id)
  const cur = { ...l.progress, ...p }
  db.prepare('UPDATE lessons SET progress = ? WHERE id = ?').run(JSON.stringify(cur), id)
  return getLesson(id)
}

export function setDone(id: number, done: boolean) {
  const l = must(id)
  db.prepare('UPDATE lessons SET done = ? WHERE id = ?').run(done ? now() : null, id)
  // finishing a lesson is the moment the skillset learns about it (once per lesson)
  if (done && l.lesson && !l.skills) { db.prepare('UPDATE lessons SET skills_state = \'pending\' WHERE id = ?').run(id); tick() }
  return getLesson(id)
}

// ---- the skillset -----------------------------------------------------------------------------------------

export const listSkills = () => (db.prepare('SELECT * FROM skills ORDER BY area, level DESC, name').all() as any[])

export function putSkill(name: string, area: string, level: number, note: string | null, source: string) {
  db.prepare(`INSERT INTO skills (name, area, level, note, source, updated) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET area = excluded.area, level = excluded.level, note = coalesce(?, note), source = excluded.source, updated = excluded.updated`)
    .run(name, area, level, note ?? '', source, now(), note)
}
export const dropSkill = (name: string) => db.prepare('DELETE FROM skills WHERE name = ?').run(name)

/** the first skillset: what the CV (Jobs tab, 2026-10) and the homelab show. Levels are a starting guess the owner corrects. */
const SEED: [string, string, number, string, string][] = [
  ['TypeScript', 'languages', 4, 'daily language at work and in the homelab dashboard', 'cv'],
  ['Python', 'languages', 4, 'FastAPI backends, scrapers, the pve agent', 'cv'],
  ['SQL', 'data', 3, 'PostgreSQL, SQLite, DuckDB', 'cv'],
  ['Vue / Nuxt', 'web', 4, 'built the homelab dashboard and several apps', 'cv'],
  ['React', 'web', 3, 'on the CV', 'cv'],
  ['FastAPI', 'web', 3, 'deals / jobs / flats services', 'cv'],
  ['WebRTC', 'web', 2, 'on the CV', 'cv'],
  ['PostgreSQL', 'data', 3, 'on the CV', 'cv'],
  ['SQLite', 'data', 3, 'every homelab app keeps its state in it', 'homelab'],
  ['DynamoDB', 'data', 2, 'on the CV', 'cv'],
  ['DuckDB', 'data', 2, 'on the CV', 'cv'],
  ['SQLAlchemy / Prisma', 'data', 3, 'ORMs from the CV', 'cv'],
  ['AWS serverless (Lambda)', 'cloud', 3, 'serverless architectures at work', 'cv'],
  ['Azure Functions', 'cloud', 2, 'on the CV', 'cv'],
  ['Terraform', 'devops', 2, 'on the CV; portfolio infra written, not applied', 'cv'],
  ['GitLab CI/CD', 'devops', 3, 'on the CV', 'cv'],
  ['Docker', 'devops', 3, 'game servers, media stack, dev containers', 'homelab'],
  ['Git', 'devops', 3, 'every project', 'homelab'],
  ['Linux & systemd', 'systems', 3, 'runs a Proxmox host, units and timers', 'homelab'],
  ['Proxmox / LXC', 'systems', 3, 'a dozen containers, backups, GPU sharing', 'homelab'],
  ['ZFS', 'systems', 2, 'pools on the homelab host', 'homelab'],
  ['Networking basics (DNS, reverse proxies)', 'networking', 2, 'Caddy, tailscale serve, VPN-isolated download box', 'homelab'],
  ['Tailscale / WireGuard', 'networking', 2, 'whole homelab on a tailnet', 'homelab'],
  ['LLM apps (OpenAI API, agents)', 'ai', 3, 'AI features at work, agent orchestration', 'cv'],
  ['Semantic search', 'ai', 2, 'on the CV', 'cv'],
  ['Local LLMs (Ollama)', 'ai', 3, 'qwen on the 3060 behind the dashboard', 'homelab'],
]
// lessons from the daily days count for this week's slot, so the switch doesn't write one right away
if (migrated) db.prepare('UPDATE lessons SET week = ? WHERE status != \'queued\' AND week IS NULL').run(lessonWeek())
// in one transaction behind a flag: a restart mid-seed (it happened, 2026-10-24) must not leave half a skillset
db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)')
if (!db.prepare('SELECT 1 FROM meta WHERE k = \'seeded\'').get()) {
  db.exec('BEGIN')
  const ins = db.prepare('INSERT OR IGNORE INTO skills (name, area, level, note, source, updated) VALUES (?, ?, ?, ?, ?, ?)')
  for (const [n, a, l, note, src] of SEED) ins.run(n, a, l, note, src, now())
  db.prepare('INSERT INTO meta (k, v) VALUES (\'seeded\', ?)').run(String(now()))
  db.exec('COMMIT')
}

const SKILLS_SCHEMA = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, area: { type: 'string', enum: [...TRACKS] }, level: { type: 'integer' }, note: { type: 'string' } }, required: ['name', 'area', 'level', 'note'] },
    },
  },
  required: ['changes'],
}

function skillsPrompt(l: any) {
  const x = l.lesson, s = quizScore(l)
  return `You keep a learner's tech skillset up to date. They just finished a one-hour lesson.

LESSON: ${x.title} [${x.track}, ${x.level}]
Objectives: ${x.objectives.join(' / ')}
Quiz: ${s.right} of ${s.total} right (${s.answered} answered). Hands-on tasks done: ${l.progress?.tasks?.length ?? 0} of ${x.tasks.length}.

CURRENT SKILLSET (level 1 aware, 2 basics, 3 working, 4 strong, 5 expert):
${listSkills().map(k => `- ${k.name} [${k.area}] ${k.level}: ${k.note}`).join('\n')}

Return only the skills this lesson changes, 1 to 3 entries:
- An existing skill (use its exact name) moves up by at most one level, and only if the lesson really goes beyond their current level and the quiz went well (most right). One lesson never lifts anything past 3.
- A new skill the lesson taught gets level 1 (quiz weak) or 2 (quiz mostly right). Name it the way a CV would ("Kubernetes", "TLS / PKI"), not after the lesson title.
- note: one short line of evidence, e.g. "lesson 'How TLS 1.3 handshakes work', quiz 7/8" — mention a weak quiz there.
- If the quiz went badly, don't raise anything; you may still add the topic as a new level-1 skill.`
}

function quizScore(l: any) {
  const q = l.lesson?.quiz ?? [], a = l.progress?.quiz ?? {}
  return { right: q.filter((x: any, i: number) => a[i] === x.answer).length, answered: Object.keys(a).length, total: q.length }
}

export function deleteLesson(id: number) {
  const l = getLesson(id)
  if (l?.status === 'writing') throw createError({ statusCode: 409, statusMessage: 'Claude is still writing this one' })
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id)
}

// ---- the prompt -----------------------------------------------------------------------------------------

const str = { type: 'string' }
export const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    title: str,
    track: { type: 'string', enum: [...TRACKS] },
    level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
    summary: str,
    why: str,
    objectives: { type: 'array', items: str },
    sections: { type: 'array', items: { type: 'object', properties: { title: str, minutes: { type: 'integer' }, body: str }, required: ['title', 'minutes', 'body'] } },
    quiz: {
      type: 'array',
      items: { type: 'object', properties: { q: str, options: { type: 'array', items: str }, answer: { type: 'integer' }, why: str }, required: ['q', 'options', 'answer', 'why'] },
    },
    tasks: { type: 'array', items: { type: 'object', properties: { title: str, minutes: { type: 'integer' }, body: str, solution: str }, required: ['title', 'minutes', 'body', 'solution'] } },
    recap: { type: 'array', items: str },
    resources: { type: 'array', items: { type: 'object', properties: { title: str, url: str }, required: ['title', 'url'] } },
    next: { type: 'array', items: str },
  },
  required: ['title', 'track', 'level', 'summary', 'why', 'objectives', 'sections', 'quiz', 'tasks', 'recap', 'resources', 'next'],
}

function prompt(topic: string) {
  const all = listLessons().filter((l: any) => l.lesson)
  const past = all.slice(0, 150).map((l: any) => `- ${l.lesson.title} [${l.lesson.track}, ${l.lesson.level}]${l.done ? ' ✓ finished' : ''}${quizLine(l)}`)
  const recent = all.slice(0, 3).map((l: any) => l.lesson.track)
  const wishes = (db.prepare('SELECT topic FROM lessons WHERE status = \'queued\' ORDER BY id').all() as any[]).map(r => r.topic)
  const skills = listSkills().map(k => `${k.name} ${k.level}`).join(', ')
  return `You write this week's lesson for a personal weekly tech course. It must fill about one focused hour: ~35 minutes of reading, a quiz, then ~20 minutes of hands-on tasks.

THE LEARNER: a computer science master's student (TU Berlin) and working-student full-stack / AI engineer who runs a Proxmox homelab: LXC containers, ZFS, Docker, Tailscale, systemd, a local LLM on an RTX 3060. They want breadth across all of tech: programming languages, CS concepts, cloud, DevOps, systems, networking, security, data, web, AI. Assume they know the basics of programming; explain everything else properly. They read on a phone.
Their skillset (1 aware … 5 expert): ${skills}
Pitch the lesson just above what they know: don't re-teach a level-4/5 skill's basics, and favour gaps next to their strong skills.

${topic ? `THIS WEEK'S TOPIC (the learner picked it): ${topic}\nTeach exactly this. Choose the level and angle that fit the library below.` : `PICK THIS WEEK'S TOPIC yourself. Rules:
- Something concrete and useful, narrow enough for one hour ("How TLS 1.3 handshakes work", not "Security").
- Not a repeat of anything in the library below; a deeper follow-up of a finished lesson is welcome.
- Vary the track: the last lessons were ${recent.join(', ') || 'none yet'}, so pick a different one.${wishes.length ? `\n- The learner's own wish list (they will get these in other weeks, don't take them): ${wishes.join('; ')}` : ''}`}

LIBRARY SO FAR (newest first):
${past.join('\n') || '(empty: this is the first lesson)'}

HOW TO WRITE IT
- English, clear and friendly, like an excellent senior colleague. No fluff, no "In this lesson we will…" filler.
- sections: 4 to 6 reading sections, minutes summing to ~35. Each body is Markdown (no top-level heading, use ### for sub-headings if needed), 800 to 1200 words (about 4,000 to 6,000 words of reading in total: this is a real course hour, not a blog post), with concrete examples, fenced code blocks with a language tag, small ASCII diagrams where they help, and the "why" behind things, common pitfalls and how it is done in real life. Build up from the intuition to the details.
- Be technically accurate. Prefer stable, well-established facts; if something changed recently or differs between versions, say so.
- quiz: 6 to 8 multiple-choice questions, 4 options each, "answer" is the 0-based index of the right option. Test understanding, not trivia, and spread the right answer's position. "why" explains the right answer in 1-3 sentences.
- tasks: 2 or 3 hands-on exercises, minutes summing to ~20, doable on a Linux dev box or the homelab with free tools (no paid accounts; for cloud topics use free tiers, LocalStack, kind/k3d, or a "design it on paper" task). body = Markdown with exact steps or the problem statement; solution = Markdown with a worked solution and what to look for.
- objectives: 3 to 5 "You can …" bullets. why: one or two sentences on why this matters for them. summary: one sentence for the library card. title: short and specific.
- recap: 4 to 6 key takeaways. resources: 2 to 4 links to official docs, RFCs, or well-known canonical pages only, with URLs you are sure exist. next: 2 or 3 follow-up topic ideas.`
}

const quizLine = (l: any) => {
  const q = l.lesson?.quiz ?? [], a = l.progress?.quiz ?? {}
  const n = Object.keys(a).length
  return n ? `, quiz ${q.filter((x: any, i: number) => a[i] === x.answer).length}/${n}` : ''
}

// models put the right answer at B far too often: shuffle the options, keep track of the right one
function shuffle(q: any) {
  const o = q.options.map((text: string, i: number) => ({ text, right: i === q.answer }))
  for (let i = o.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [o[i], o[k]] = [o[k], o[i]] }
  return { ...q, options: o.map((x: any) => x.text), answer: o.findIndex((x: any) => x.right) }
}

function valid(j: any) {
  if (!j?.title || !Array.isArray(j.sections) || !j.sections.length) throw new Error('the lesson came back without sections')
  if (!(TRACKS as readonly string[]).includes(j.track)) j.track = 'concepts'
  j.quiz = (j.quiz ?? []).filter((q: any) => Array.isArray(q.options) && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length)
    .map(shuffle)
  j.resources = (j.resources ?? []).filter((r: any) => /^https:\/\/[^\s]+$/.test(r.url))
  return j
}

// ---- the worker ------------------------------------------------------------------------------------------

const agentCall = <T = any>(path: string, opts: UpstreamOpts = {}) => {
  const { agentUrl, agentToken } = useRuntimeConfig()
  return upstream<T>('agent', agentUrl, agentToken, path, 30_000, opts)
}

async function start(id: number) {
  const l = getLesson(id)
  const job = `l${id}${randomBytes(3).toString('hex')}`
  db.prepare('UPDATE lessons SET status = \'writing\', job = ?, error = NULL WHERE id = ?').run(job, id)
  try {
    await agentCall('/learn/start', { method: 'POST', body: { job, prompt: prompt(l.topic), schema: LESSON_SCHEMA, model: 'sonnet' } })
  } catch (e: any) {
    db.prepare('UPDATE lessons SET status = \'failed\', error = ? WHERE id = ?').run(String(e?.statusMessage || e?.message).slice(0, 300), id)
  }
}

async function startSkills(id: number) {
  const job = `s${id}${randomBytes(3).toString('hex')}`
  db.prepare('UPDATE lessons SET skills_state = \'writing\', skills_job = ? WHERE id = ?').run(job, id)
  try {
    await agentCall('/learn/start', { method: 'POST', body: { job, prompt: skillsPrompt(getLesson(id)), schema: SKILLS_SCHEMA, model: 'sonnet' } })
  } catch { db.prepare('UPDATE lessons SET skills_state = \'failed\' WHERE id = ?').run(id) }
}

async function checkSkills(r: any) {
  let s: any
  try { s = await agentCall(`/learn/job?id=${r.skills_job}`) } catch { return }
  if (s.state === 'running') return
  if (s.state !== 'done') { db.prepare('UPDATE lessons SET skills_state = \'failed\' WHERE id = ?').run(r.id); return }
  for (const c of (s.result?.changes ?? []).slice(0, 4)) {
    const name = String(c.name ?? '').trim().slice(0, 60)
    if (!name) continue
    const cur: any = db.prepare('SELECT level FROM skills WHERE name = ?').get(name)
    // the rules again in code: +1 at most, a new one starts at 1 or 2, lessons alone stop at 3, never down
    const want = Math.round(Number(c.level)) || 1
    const level = cur ? Math.max(cur.level, Math.min(cur.level + 1, want, Math.max(cur.level, 3))) : Math.min(Math.max(want, 1), 2)
    putSkill(name, (TRACKS as readonly string[]).includes(c.area) ? c.area : 'concepts', level, String(c.note ?? '').slice(0, 200), 'lesson')
  }
  db.prepare('UPDATE lessons SET skills_state = \'done\' WHERE id = ?').run(r.id)
}

async function check(r: any) {
  let s: any
  try { s = await agentCall(`/learn/job?id=${r.job}`) } catch { return } // agent restarting (deploy): ask again next minute
  if (s.state === 'running') return
  if (s.state === 'done') {
    try {
      const j = valid(s.result)
      db.prepare('UPDATE lessons SET status = \'ready\', data = ?, secs = ?, error = NULL WHERE id = ?').run(JSON.stringify(j), s.secs ?? null, r.id)
      return
    } catch (e: any) { s = { error: e.message } }
  }
  db.prepare('UPDATE lessons SET status = \'failed\', error = ? WHERE id = ?').run(String(s.error || 'the job vanished').slice(0, 400), r.id)
}

let busy = false
export async function tick() {
  if (busy) return
  busy = true
  try {
    // skill updates are small and independent of the lesson queue
    for (const r of db.prepare('SELECT id, skills_job FROM lessons WHERE skills_state = \'writing\'').all() as any[]) await checkSkills(r)
    for (const r of db.prepare('SELECT id FROM lessons WHERE skills_state = \'pending\'').all() as any[]) await startSkills(r.id)

    for (const r of db.prepare('SELECT id, job FROM lessons WHERE status = \'writing\'').all() as any[]) await check(r)
    if (db.prepare('SELECT 1 FROM lessons WHERE status = \'writing\'').get()) return
    // one lesson at a time: the owner's "now" first, then the weekly one
    let next: any = db.prepare('SELECT id FROM lessons WHERE status = \'pending\' ORDER BY id LIMIT 1').get()
    const week = lessonWeek(), today = berlinDay()
    if (!next && !db.prepare('SELECT 1 FROM lessons WHERE week = ?').get(week)) {
      // the weekly lesson takes the oldest wish off the list, else Claude picks
      next = db.prepare('SELECT id FROM lessons WHERE status = \'queued\' ORDER BY id LIMIT 1').get()
      if (next) db.prepare('UPDATE lessons SET day = ?, week = ? WHERE id = ?').run(today, week, next.id)
      else next = { id: Number(db.prepare('INSERT INTO lessons (status, day, week, created) VALUES (\'pending\', ?, ?, ?)').run(today, week, now()).lastInsertRowid) }
    }
    if (next) await start(next.id)
  } catch (e) {
    console.error('learn tick', e)
  } finally { busy = false }
}
