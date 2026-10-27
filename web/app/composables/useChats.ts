export interface Chat {
  id: string, title: string, at: number, turns: Turn[]
  /** Claude chats: the Claude Code session it resumes, and whether the next message may change things */
  engine?: 'local' | 'claude', session?: string, auto?: boolean, model?: string, effort?: string
  /** the next Claude message starts the session as a copy of another one, up to that message (edit / branch) */
  fork?: { from: string, at: string } | null
  pinned?: boolean
  /** sidebar folder (free text, ≤24 chars) · task: the scheduled task that made this chat */
  folder?: string, task?: string
  /** Claude may hand work to cheaper subagents (default on) · incognito: never stored or synced */
  team?: boolean, incognito?: boolean
  /** AI title: when it was last set (ms) · titleManual is set when the user names a chat by hand (never overwritten) */
  titledAt?: number, titleManual?: boolean
  /** when this device last changed it (ms); the newer copy wins between devices */
  upd?: number
}
export type ChatStatus = 'busy' | 'input' | ''
const KEY = 'chat.convos'
const MAX = 40

/** what gets stored, here and on the server: no live state, long reasoning cut */
const compact = (c: Chat) => {
  const { upd, ...rest } = c
  return {
    ...rest,
    turns: c.turns.map(({ q, a, r, model, tps, error, at, tools, ct, auto, secs, denied, fin, effort, answered, clear, imgs, sid, uuid, ctx, compacted, usage, team, plan, executed, cmp, vote, sources }) => ({
      q, a, r: r?.slice(0, 4000) ?? '', model, tps, error, at, ct, auto, secs, denied, fin, effort, answered, clear, imgs, sid, uuid, ctx, compacted, usage, team, plan, executed, vote, sources,
      cmp: cmp?.map(({ key, engine, label, q, a, error, ct, fin, model, secs, tps, usage }) => ({ key, engine, label, q, a, r: '', error, ct, fin, model, secs, tps, usage })),
      tools: tools?.slice(-40).map(({ name, label, done, error }) => ({ name, label, done, error, args: null })),
    })),
  }
}
// sync bookkeeping (browser only): what the server last saw of each chat, and what still has to go up
const sent = new Map<string, string>()
const dirty = new Set<string>()
const dels = new Set<string>()
let seq = 0
let flushing = false

/**
 * Conversations are shared by every device via /api/chats (sqlite in CT 104); localStorage is only a cache so the
 * page opens instantly. Every few seconds the page pulls what other devices changed. A Claude chat's history also
 * sits in its session on pve.
 */
export function useChats() {
  const chats = useState<Chat[]>('chats', () => [])
  const currentId = useState<string>('chats:current', () => '')
  const loaded = useState('chats:loaded', () => false)

  const load = () => {
    if (loaded.value) return
    loaded.value = true
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
      if (Array.isArray(raw)) chats.value = raw.filter(c => c?.id && Array.isArray(c.turns))
    } catch {}
    if (!chats.value.length) create()
    else currentId.value = chats.value[0]!.id
    pull(true)
    setInterval(() => document.visibilityState === 'visible' && pull(), 4000)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pull())
  }

  /** take what other devices changed; a chat that is answering on this device is left alone until it's done */
  async function pull(first = false) {
    let r: { seq: number, chats: Chat[], gone: string[] }
    try { r = await $fetch('/api/chats', { query: { since: first ? 0 : seq } }) } catch { return }
    const placeholder = first && chats.value.length === 1 && !chats.value[0]!.turns.length && !sent.has(chats.value[0]!.id)
      ? chats.value[0]!.id : ''
    for (const id of r.gone) {
      sent.delete(id); dirty.delete(id)
      if (chats.value.some(c => c.id === id)) chats.value = chats.value.filter(c => c.id !== id)
    }
    for (const s of r.chats) {
      const i = chats.value.findIndex(c => c.id === s.id)
      const local = chats.value[i]
      const json = JSON.stringify(compact(s))
      if (local?.turns.some(t => t.busy)) continue
      if (local && ((local.upd ?? 0) > (s.upd ?? 0) || JSON.stringify(compact(local)) === json)) {
        if ((local.upd ?? 0) <= (s.upd ?? 0)) sent.set(s.id, json)
        continue
      }
      sent.set(s.id, json)
      dirty.delete(s.id)
      if (local) chats.value[i] = s
      else {
        const at = chats.value.findIndex(c => c.at < s.at)
        at < 0 ? chats.value.push(s) : chats.value.splice(at, 0, s)
      }
    }
    // a brand-new device: drop the empty chat it made while loading and continue the latest one
    if (placeholder && chats.value.length > 1) {
      chats.value = chats.value.filter(c => c.id !== placeholder)
      currentId.value = chats.value[0]!.id
    }
    if (first) {
      chats.value.sort((a, b) => b.at - a.at)
      // chats that only ever lived in this browser go up now (the first time per device)
      for (const c of chats.value) if (!sent.has(c.id) && c.turns.length) dirty.add(c.id)
    }
    if (!chats.value.some(c => c.id === currentId.value)) chats.value.length ? (currentId.value = chats.value[0]!.id) : create()
    seq = Math.max(seq, r.seq)
    cache()
    flush()
  }

  async function flush() {
    if (flushing || (!dirty.size && !dels.size)) return
    flushing = true
    const put = [...dirty].map(id => chats.value.find(c => c.id === id)).filter(Boolean).map(c => ({ ...compact(c!), upd: c!.upd }))
    const del = [...dels]
    dirty.clear(); dels.clear()
    let ok = true
    try { await $fetch('/api/chats', { method: 'POST', body: { put, del } }) } catch {
      ok = false
      put.forEach(c => dirty.add(c.id)); del.forEach(id => dels.add(id))
    } finally { flushing = false }
    if (dirty.size || dels.size) ok ? flush() : setTimeout(flush, 3000)
  }

  const cache = () => {
    try { localStorage.setItem(KEY, JSON.stringify(chats.value.filter(c => !c.incognito).slice(0, MAX).map(c => ({ ...compact(c), upd: c.upd })))) } catch {}
  }

  const save = () => {
    for (const c of chats.value) {
      if (c.incognito) continue // lives in this tab only: gone on reload, never on the server
      const json = JSON.stringify(compact(c))
      if (sent.get(c.id) === json || (!c.turns.length && !sent.has(c.id))) continue
      sent.set(c.id, json)
      c.upd = Date.now()
      dirty.add(c.id)
    }
    cache()
    flush()
  }

  function create(incognito = false) {
    const chat: Chat = { id: Math.random().toString(36).slice(2, 10), title: 'New chat', at: Date.now(), turns: [], ...(incognito ? { incognito } : {}) }
    chats.value.unshift(chat)
    currentId.value = chat.id
    return chat
  }

  const current = computed(() => chats.value.find(c => c.id === currentId.value) ?? chats.value[0])

  function remove(id: string) {
    chats.value = chats.value.filter(c => c.id !== id)
    sent.delete(id); dirty.delete(id); dels.add(id)
    if (!chats.value.length) create()
    else if (currentId.value === id) currentId.value = chats.value[0]!.id
    save()
  }

  /** first question becomes the title, like every other chat app */
  function touch() {
    const c = current.value
    if (!c) return
    if (c.turns.length && (c.title === 'New chat' || !c.title)) c.title = c.turns[0]!.q.slice(0, 60)
    c.at = Date.now()
    save()
    nameChat(c).catch(() => {})
  }

  /** local model titles the chat after the first answer, and again when the title is over an hour old */
  const naming = new Set<string>()
  async function nameChat(c: Chat) {
    if (c.incognito || c.titleManual || naming.has(c.id)) return
    const done = c.turns.filter(t => !t.busy && !t.clear && !t.error && (t.fin || t.answered || t.a) && t.a?.trim())
    const last = done.at(-1)
    if (!last || c.turns.some(t => t.busy)) return
    if (c.titledAt !== undefined && Date.now() - c.titledAt <= 3600_000) return
    const first = c.titledAt === undefined
    if (first && c.title !== 'New chat' && c.title !== c.turns[0]?.q.slice(0, 60)) return // title already set some other way
    const q = first ? done[0]!.q : c.turns.filter(t => t.q && !t.clear).slice(-3).map(t => t.q).join('\n')
    naming.add(c.id)
    try {
      const r: any = await $fetch('/api/chats/title', { method: 'POST', body: { q, a: last.a, ...(first ? {} : { prior: c.title }) } })
      if (r?.title && !c.titleManual && chats.value.some(x => x.id === c.id)) {
        c.title = r.title
        c.titledAt = Date.now()
        save()
      }
    } catch { /* model busy or unreachable: keep the current title */ } finally { naming.delete(c.id) }
  }

  /** busy: an answer is still coming · input: the last answer ends in questions nobody has answered yet */
  function status(c?: Chat): ChatStatus {
    if (!c) return ''
    if (c.turns.some(t => t.busy)) return 'busy'
    const last = c.turns.at(-1)
    return last && !last.clear && !last.error && !last.answered && splitQuestions(last.a).qs ? 'input' : ''
  }
  /** the most urgent status over every chat, for the nav */
  const overall = computed<ChatStatus>(() => {
    const all = chats.value.map(status)
    return all.includes('input') ? 'input' : all.includes('busy') ? 'busy' : ''
  })

  return { chats, current, currentId, create, remove, load, save, touch, nameChat, status, overall }
}
