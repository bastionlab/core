import type { Chat } from '~/composables/useChats'
import { sinceClear, type Tool, type Turn } from '~/composables/useAsk'

const base = (p = '') => p.split('/').filter(Boolean).pop() ?? p
const short = (s = '', n = 70) => (s = s.replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n - 1) + '…' : s

/** one pill per tool call, readable on a phone */
function label(name: string, a: any = {}) {
  switch (name) {
    case 'Bash': return `$ ${short(a.command)}`
    case 'Read': return `read ${base(a.file_path)}`
    case 'Write': return `wrote ${base(a.file_path)}`
    case 'Edit': case 'MultiEdit': return `edited ${base(a.file_path)}`
    case 'Grep': return `grep “${short(a.pattern, 40)}”`
    case 'Glob': return `files ${short(a.pattern, 40)}`
    case 'WebSearch': return `searched “${short(a.query, 50)}”`
    case 'WebFetch': return `read ${short(String(a.url ?? '').replace(/^https?:\/\//, ''), 40)}`
    case 'Task': case 'Agent': return `agent: ${short(a.description, 50)}`
    case 'TodoWrite': return 'updated its todo list'
    default: return name
  }
}

export const CLAUDE_MODELS = [
  { id: 'fable', label: 'Fable 5.1' }, { id: 'opus', label: 'Opus 5.5' },
  { id: 'sonnet', label: 'Sonnet 5.5' }, { id: 'haiku', label: 'Haiku 5.5' },
]
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const attached = new Set<string>()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Claude Code on pve, one `claude -p` per message, resumed by the chat's session id. The turn runs in its own
 * systemd unit on the host, so this side only tails its stream-json; a dropped stream (deploy, phone asleep,
 * reload) is replayed from line 0, which makes reconnecting idempotent.
 */
export function useClaude(save: () => void) {
  let saveTimer: any = null
  const saveSoon = () => { saveTimer ??= setTimeout(() => { saveTimer = null; save() }, 800) }

  const { seen } = useClaudeUsage()

  function apply(t: Turn, ev: any) {
    if (ev.type === 'rate_limit_event') return seen(ev.rate_limit_info)
    if (ev.parent_tool_use_id) return // a subagent's inner steps — its call already shows as one pill
    if (ev.type === 'system' && ev.subtype === 'init') t.model = ev.model
    else if (ev.type === 'stream_event') {
      const e = ev.event
      if (e?.type === 'content_block_start' && e.content_block?.type === 'text' && t.a && !t.a.endsWith('\n\n')) t.a += '\n\n'
      if (e?.type === 'content_block_delta') {
        if (e.delta?.type === 'text_delta') t.a += e.delta.text
        else if (e.delta?.type === 'thinking_delta') t.r += e.delta.thinking
      }
    } else if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'tool_use' && !t.tools!.some(x => x.id === b.id)) t.tools!.push({ id: b.id, name: b.name, args: b.input, label: label(b.name, b.input) })
      }
    } else if (ev.type === 'user') {
      for (const b of ev.message?.content ?? []) {
        if (b.type !== 'tool_result') continue
        const tl = t.tools!.find(x => x.id === b.tool_use_id)
        if (!tl) continue
        tl.done = true
        if (b.is_error) {
          const msg = typeof b.content === 'string' ? b.content : (b.content ?? []).map((c: any) => c.text ?? '').join(' ')
          tl.error = /denied|don't ask mode|disabled for this session/i.test(msg) ? 'blocked' : short(msg.replace(/<\/?tool_use_error>/g, ''), 80)
        }
      }
    } else if (ev.type === 'result') {
      t.secs = Math.round((ev.duration_ms ?? 0) / 1000)
      t.denied = (ev.permission_denials ?? []).map((d: any) => label(d.tool_name, d.tool_input))
      if (ev.is_error || ev.subtype !== 'success') t.error = short(String(ev.result || ev.subtype || 'failed'), 300)
      t.fin = true
    }
  }

  async function read(t: Turn, body: ReadableStream<Uint8Array>) {
    const reader = body.getReader(), dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return false
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const ev = /^event: (.*)$/m.exec(block)?.[1]
        const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n')
        if (ev === 'end') {
          const err = (() => { try { return JSON.parse(data).err } catch { return '' } })()
          if (!t.fin && !t.error) t.error = t.stopped ? 'stopped' : (short(err, 300) || 'Claude exited without an answer')
          return true
        }
        if (data) { try { apply(t, JSON.parse(data)) } catch {} }
      }
      saveSoon()
    }
  }

  /** follow a running (or finished) turn until its process is gone; safe to call twice */
  async function attach(t: Turn) {
    if (!t.ct || attached.has(t.ct)) return
    attached.add(t.ct)
    t.busy = true
    try {
      for (let attempt = 0; ; attempt++) {
        Object.assign(t, { a: '', r: '', tools: [], denied: [], error: undefined, fin: false })
        try {
          const res = await fetch(`/api/claude/stream?turn=${encodeURIComponent(t.ct)}`)
          if (res.status === 410 || res.status === 400) { t.error = 'this answer is no longer on the server'; break }
          if (res.ok && res.body && await read(t, res.body)) break
        } catch {}
        if (attempt >= 150) { t.error = 'lost the connection to pve'; break } // ~5 min: a deploy takes ~2
        await sleep(2000)
      }
    } finally {
      t.busy = false
      t.fin = true
      attached.delete(t.ct)
      save()
    }
  }

  async function ask(c: Chat, text: string) {
    text = text.trim()
    if (!text || c.turns.some(t => t.busy)) return
    let prompt = text
    if (!c.session) {
      // switching an existing local-model chat over to Claude: hand it what was said so far
      const prior = sinceClear(c.turns).filter(t => !t.error).map(t => `Owner: ${t.q}\nAssistant (${t.model || 'local model'}): ${t.a}`).join('\n\n')
      if (prior) prompt = `Earlier in this chat, with a local model:\n\n${prior.slice(-12000)}\n\n---\n\n${text}`
      c.session = crypto.randomUUID()
    }
    c.turns.push({ q: text, a: '', r: '', tools: [], busy: true, at: Date.now(), auto: !!c.auto, model: 'claude', effort: c.effort })
    const t = c.turns[c.turns.length - 1]!
    try {
      const r = await $fetch<{ turn: string }>('/api/claude/send', { method: 'POST', body: { chat: c.id, session: c.session, prompt, auto: !!c.auto, model: c.model, effort: c.effort } })
      t.ct = r.turn
      save()
      await attach(t)
    } catch (e: any) {
      t.error = e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed'
      t.busy = false
      t.fin = true
      save()
    }
  }

  async function stop(c: Chat) {
    c.turns.forEach(t => { if (t.busy) t.stopped = true })
    await $fetch('/api/claude/stop', { method: 'POST', body: { chat: c.id } }).catch(() => {})
  }

  return { ask, attach, stop }
}
