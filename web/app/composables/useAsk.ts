import { marked } from 'marked'

export interface Tool { name: string, args: any, done?: boolean, error?: string }
export interface Proposal { action: string, args: any, desc: string, why?: string, state?: 'idle' | 'running' | 'done' | 'failed' | 'dismissed', job?: any }
export interface Turn { q: string, a: string, r: string, tools?: Tool[], proposals?: Proposal[], model?: string, tps?: number | null, error?: string, busy?: boolean, at?: number }

// model output is untrusted: render markdown but show any raw HTML as text
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
marked.use({ renderer: { html: ({ text }: any) => esc(text) } })
export const md = (s: string) => marked.parse(s, { async: false }) as string

/** the model picker and the web/think toggles are shared by every page */
export function useAskSettings() {
  const model = useState('ask:model', () => '')
  const think = useState('ask:think', () => false)
  const web = useState('ask:web', () => true)
  const { data: all, refresh: refreshModels } = useShared<any[]>('models', '/api/ai/models')
  const models = computed(() => all.value?.filter(m => !m.uncensored) ?? [])

  onMounted(() => {
    try {
      model.value = localStorage.getItem('ask.model') || model.value
      think.value = localStorage.getItem('ask.think') === '1'
      web.value = localStorage.getItem('ask.web') !== '0'
    } catch {}
    if (!all.value) refreshModels()
  })
  watch(models, (m) => { if (m?.length && !m.some(x => x.name === model.value)) model.value = m[0].name }, { immediate: true })
  watch([model, think, web], () => {
    try {
      localStorage.setItem('ask.model', model.value)
      localStorage.setItem('ask.think', think.value ? '1' : '0')
      localStorage.setItem('ask.web', web.value ? '1' : '0')
    } catch {}
  })
  return { model, think, web, models, refreshModels }
}

/**
 * One conversation with a local model, streamed as NDJSON. `scope` decides which slice of the
 * homelab the server puts in the system prompt and which actions the model may propose.
 */
export function useAsk(scope: string, turns: Ref<Turn[]>, onChange?: () => void) {
  const { model, think, web, models, refreshModels } = useAskSettings()
  const busy = computed(() => turns.value.some(t => t.busy))
  let ctl: AbortController | null = null

  async function ask(text: string) {
    text = text.trim()
    if (!text || busy.value) return
    const history = turns.value.filter(t => !t.error).flatMap(t => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.a }])
    turns.value.push({ q: text, a: '', r: '', tools: [], proposals: [], busy: true, at: Date.now() })
    const t = turns.value[turns.value.length - 1]!
    ctl = new AbortController()
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ q: text, model: model.value, think: think.value, web: web.value, scope, history }),
      })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.statusMessage || `HTTP ${res.status}`)
      const reader = res.body.getReader(), dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()!
        for (const line of lines) {
          if (!line) continue
          const j = JSON.parse(line)
          if (j.r) t.r += j.r
          if (j.c) t.a += j.c
          if (j.proposal) t.proposals!.push({ ...j.proposal, state: 'idle' })
          if (j.tool) t.tools!.push({ name: j.tool, args: j.args })
          if (j.toolDone) { const x = t.tools!.findLast(v => v.name === j.toolDone && !v.done); if (x) { x.done = true; x.error = j.error } }
          if (j.error) t.error = j.error
          if (j.done) { t.model = j.model; t.tps = j.tps }
        }
        onChange?.()
      }
    } catch (e: any) {
      t.error = e.name === 'AbortError' ? 'stopped' : e.message
    } finally {
      t.busy = false
      ctl = null
      refreshModels()
      onChange?.()
    }
  }

  /** nothing runs until the owner clicks Run; then poll the job until it finishes */
  async function run(p: Proposal, after?: () => void) {
    p.state = 'running'
    try {
      p.job = await $fetch('/api/ai/action/run', { method: 'POST', body: { name: p.action, args: p.args } })
      for (;;) {
        await new Promise(r => setTimeout(r, 1500))
        p.job = await $fetch('/api/ai/action/status', { query: { id: p.job.id } })
        if (p.job.done) break
      }
      p.state = p.job.rc === 0 ? 'done' : 'failed'
    } catch (e: any) {
      p.job = { log: [e?.statusMessage || e?.message || 'failed'] }
      p.state = 'failed'
    }
    after?.()
    onChange?.()
  }

  const stop = () => ctl?.abort()
  return { ask, run, stop, busy, model, think, web, models }
}
