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
    turns: c.turns.map(({ id, q, a, r, model, tps, error, at, tools, ct, auto, secs, denied, fin, effort, answered, clear, imgs, sid, uuid, ctx, compacted, usage, team, plan, executed, cmp, vote, sources, proposals, narr }) => ({
      id, q, a, r: r?.slice(0, 4000) ?? '', model, tps, error, at, ct, auto, secs, denied, fin, effort, answered, clear, imgs, sid, uuid, ctx, compacted, usage, team, plan, executed, vote, sources,
      cmp: cmp?.map(({ key, engine, label, q, a, error, ct, fin, model, secs, tps, usage }) => ({ key, engine, label, q, a, r: '', error, ct, fin, model, secs, tps, usage })),
      // action cards survive a reload; the job (with its log) doesn't, so a card that was mid-run reads as 'sent' (no Run button: it would run twice)
      proposals: proposals?.map(({ action, args, desc, why, state }) => ({ action, args, desc, why, state: state === 'running' ? 'sent' as const : state })),
      narr: narr?.length ? narr : undefined,
      tools: tools?.slice(-40).map(({ name, label, done, error }) => ({ name, label, done, error, args: null })),
    })),
  }
}
/** every turn carries a stable id so two devices' copies of a chat can be merged turn by turn; old turns get the same deterministic one on every device */
const ensureIds = (c: Chat) => { for (const t of c.turns) t.id ||= `l${t.at ?? 0}-${t.q?.length ?? 0}` }
/** union of two copies of a chat's turns by id (the longer answer wins a tie on id), ordered by time */
const mergeTurns = (a: Turn[], b: Turn[]) => {
  const m = new Map<string, Turn>()
  for (const t of [...a, ...b]) {
    const old = m.get(t.id!)
    if (!old || (t.a?.length ?? 0) + (t.r?.length ?? 0) > (old.a?.length ?? 0) + (old.r?.length ?? 0)) m.set(t.id!, old?.busy ? old : t)
  }
  return [...m.values()].map((t, i) => ({ t, i })).sort((x, y) => (x.t.at ?? 0) - (y.t.at ?? 0) || x.i - y.i).map(x => x.t)
}
// sync bookkeeping (browser only): what the server last saw of each chat, and what still has to go up
const sent = new Map<string, string>()
const dirty = new Set<string>()
const dels = new Set<string>()
let seq = 0
/** chats the pull skipped because a turn is answering on this device: fetched by id once it ends */
const held = new Set<string>()
/** chats the server refused (id -> the `upd` that was refused), per device: not re-sent or re-announced for the same edit */
const REJ = 'chat.rejected'
const rejected: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem(REJ) || '{}') } catch { return {} } })()
let flushing = false
/** how often a refused chat was re-merged and re-sent (per chat) */
const retries = new Map<string, number>()

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
      chats.value.forEach(ensureIds)
    } catch {}
    if (!chats.value.length) create()
    else currentId.value = chats.value[0]!.id
    pull(true)
    setInterval(() => document.visibilityState === 'visible' && pull(), 4000)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' ? pull() : flush())
    window.addEventListener('focus', () => pull())
    window.addEventListener('online', () => pull())
  }

  /** take what other devices changed; a chat that is answering on this device is left alone until it's done */
  async function pull(first = false) {
    let r: { seq: number, chats: Chat[], gone: string[] }
    try { r = await $fetch('/api/chats', { query: { since: first ? 0 : seq } }) } catch { return }
    // chats whose turn has ended since they were skipped: fetch just those
    const ready = [...held].filter(id => !chats.value.find(c => c.id === id)?.turns.some(t => t.busy))
    if (ready.length) {
      try {
        const x: typeof r = await $fetch('/api/chats', { query: { ids: ready.join(',') } })
        ready.forEach(id => held.delete(id))
        r = { ...r, chats: [...r.chats.filter(c => !ready.includes(c.id)), ...x.chats], gone: [...r.gone, ...x.gone] }
      } catch {}
    }
    const placeholder = first && chats.value.length === 1 && !chats.value[0]!.turns.length && !sent.has(chats.value[0]!.id)
      ? chats.value[0]!.id : ''
    for (const id of r.gone) {
      sent.delete(id); dirty.delete(id)
      if (chats.value.some(c => c.id === id)) chats.value = chats.value.filter(c => c.id !== id)
    }
    for (const s of r.chats) {
      ensureIds(s)
      const i = chats.value.findIndex(c => c.id === s.id)
      const local = chats.value[i]
      const json = JSON.stringify(compact(s))
      if (local?.turns.some(t => t.busy)) { held.add(s.id); continue }
      if (local && ((local.upd ?? 0) > (s.upd ?? 0) || JSON.stringify(compact(local)) === json)) {
        if ((local.upd ?? 0) <= (s.upd ?? 0)) sent.set(s.id, json)
        continue
      }
      sent.set(s.id, json)
      if (local && dirty.has(s.id)) {
        // unsent local edits: keep both sides' turns, stay dirty so the merge goes up
        local.turns = mergeTurns(local.turns, s.turns)
        local.upd = Math.max(local.upd ?? 0, s.upd ?? 0) + 1
        continue
      }
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
    const put = [...dirty].map(id => chats.value.find(c => c.id === id)).filter(Boolean)
      .filter(c => rejected[c!.id] === undefined || rejected[c!.id] !== c!.upd).map(c => ({ ...compact(c!), upd: c!.upd }))
    const del = [...dels]
    dirty.clear(); dels.clear()
    let ok = true
    try {
      const res = await $fetch<{ rejected?: { id: string, reason: string }[] }>('/api/chats', { method: 'POST', body: { put, del } })
      if (res?.rejected?.length) {
        // 'stale': merge with the server copy and send again (a few times); 'size' never gets better, so say so at once; 'tombstone': deleted elsewhere, the pull drops it
        for (const { id, reason } of res.rejected) {
          if (reason === 'tombstone') continue
          if (reason === 'stale' && (retries.get(id) ?? 0) < 3) { recover(id); continue }
          rejected[id] = put.find(p => p.id === id)?.upd as number
          try { localStorage.setItem(REJ, JSON.stringify(rejected)) } catch {}
          const title = chats.value.find(c => c.id === id)?.title || id
          useToast().toast(`Chat "${title}" is not synced: ${reason === 'size' ? 'too large (over 5 MB)' : reason}`, { tone: 'bad', ms: 8000 })
          console.warn('chat not synced', id, reason)
        }
      }
      for (const p of put) if (!res?.rejected?.some(x => x.id === p.id)) retries.delete(p.id)
    } catch {
      ok = false
      put.forEach(c => dirty.add(c.id)); del.forEach(id => dels.add(id))
    } finally { flushing = false }
    if (dirty.size || dels.size) ok ? flush() : setTimeout(flush, 3000)
  }

  /** the server refused a chat: fetch its copy, keep every turn of both, stamp it newer than both and push again */
  async function recover(id: string) {
    retries.set(id, (retries.get(id) ?? 0) + 1)
    const local = chats.value.find(c => c.id === id)
    if (!local) return
    try {
      const x: { chats: Chat[], gone: string[] } = await $fetch('/api/chats', { query: { ids: id } })
      const s = x.chats[0]
      if (s) {
        ensureIds(s)
        local.turns = mergeTurns(local.turns, s.turns)
        local.upd = Math.max(local.upd ?? 0, s.upd ?? 0) + 1
      }
    } catch { /* offline: the next try re-sends as is */ }
    delete rejected[id]
    try { localStorage.setItem(REJ, JSON.stringify(rejected)) } catch {}
    dirty.add(id)
    cache()
    setTimeout(flush, 500)
  }

  const cache = () => {
    try { localStorage.setItem(KEY, JSON.stringify(chats.value.filter(c => !c.incognito).slice(0, MAX).map(c => ({ ...compact(c), upd: c.upd })))) } catch {}
  }

  const save = () => {
    for (const c of chats.value) {
      ensureIds(c)
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
