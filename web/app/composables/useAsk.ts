import { marked } from 'marked'
import { highlight } from '../utils/highlight'

export interface Tool { name: string, args: any, done?: boolean, error?: string, id?: string, label?: string }
export interface Proposal { action: string, args: any, desc: string, why?: string, state?: 'idle' | 'running' | 'done' | 'failed' | 'dismissed' | /** was running when stored: not runnable again */ 'sent', job?: any }
export interface Turn {
  q: string, a: string, r: string, /** screenshots sent with the question (chat image names) */ imgs?: string[], tools?: Tool[], proposals?: Proposal[], model?: string, tps?: number | null, error?: string, busy?: boolean, at?: number
  /** Claude turns: agent turn id, whether it ran with write access, how long it took, what read-only mode blocked */
  ct?: string, auto?: boolean, effort?: string, secs?: number, denied?: string[], fin?: boolean, stopped?: boolean
  /** a ```questions block the owner already answered: question index → picked labels */
  answered?: Record<number, string[]> | null
  /** a /clear divider: nothing before it is sent to the model again */
  clear?: boolean
  /** Claude turns: TodoWrite steps done/total and an ETA from the average finished-tool time (null = unknown) */
  progress?: { done: number, total: number, etaSeconds: number | null }
  /** Claude turns: background shells / tasks it started (the turn stays busy until they finish) */
  bg?: { id: string, desc: string, kind?: string, status: string, tuid?: string, out?: string }[]
  /** Claude turns: the session it ran in and its last answer's message id (an edit or branch forks there),
   *  how full the context was after it, and a compaction that happened in it */
  sid?: string, uuid?: string, ctx?: { used: number, max?: number }, compacted?: { pre: number, post: number }
  /** tokens (and list-price $) per model in this answer; team: subagents were offered; plan: answered as a plan */
  usage?: Record<string, { tok: number, usd: number }>, team?: boolean, plan?: boolean, executed?: boolean
  /** a compare turn: the same question to several models (panes A, B, C…), names hidden until `vote` */
  cmp?: (Turn & { key: string, engine: 'claude' | 'local', label: string })[], vote?: string
  /** web pages the answer used (web search / page fetches), shown as chips under it */
  sources?: { title: string, url: string }[]
  /** when the stream last showed a sign of life (live only, not stored) */
  last?: number
  /** facts the local model suggests remembering ("Remember this?" chips); [] once handled */
  mem?: string[]
}

/** merge web pages into a turn's sources: http(s) only, one per url, at most 10 */
export function addSources(t: Turn, list: any) {
  if (!Array.isArray(list)) return
  const have = t.sources ?? []
  for (const s of list) {
    const url = String(s?.url ?? '')
    if (have.length >= 10) break
    if (!/^https?:\/\//i.test(url) || have.some(x => x.url === url)) continue
    have.push({ title: String(s?.title || '').slice(0, 200), url })
  }
  if (have.length) t.sources = have
}

/** the turns since the last /clear, i.e. what the model should still remember */
export const sinceClear = (turns: Turn[]) => turns.slice(turns.findLastIndex(t => t.clear) + 1)

// model output is untrusted: render markdown but show any raw HTML as text
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
marked.use({
  renderer: {
    html: ({ text }: any) => esc(text),
    code: ({ text, lang }: any) => `<pre><code class="language-${esc(String(lang || '').split(/\s/)[0])}">${highlight(text, lang || '')}</code></pre>\n`,
  },
})
export const md = (s: string) => marked.parse(s, { async: false }) as string

// --- what the answer renderers add on top of md(): jump links and code block chrome (AskTurns + the chat's compare panes)
const PATH = String.raw`\/[a-z][\w-]*(?:\/[\w-]+)*`
const QUERY = String.raw`\?(?:[\w%=-]|\.(?=[\w%=-])|&amp;)+`
const BARE = new RegExp(String.raw`(?<=^|[\s(\[;"'])(${PATH})(${QUERY})?(?=$|[\s),;:!?\]"']|&(?:quot|#39);|\.(?!\w))`, 'g')
const WHOLE = new RegExp(String.raw`^(\/(?:[a-z][\w-]*(?:\/[\w-]+)*)?)(${QUERY})?$`)

/** the pages the owner can open: core ones + routes of add-ons that are installed, on and allowed for the role */
export function useAnswerRoutes() {
  const { list, pageOn } = useAddons()
  return computed(() => new Set([...CORE_PAGES.filter(p => p !== '/login'), ...list.flatMap(a => a.routes)].filter(p => pageOn(p))))
}

const NAMED: Record<string, string> = { colon: ':', tab: '\t', newline: '\n', sol: '/', bsol: '\\', num: '#', amp: '&', lpar: '(', rpar: ')' }
/**
 * Is this link target safe to keep in a rendered answer (model output is untrusted; marked passes any scheme through)?
 * Allowlist: /path (not //host or /\host), #anchor, http:, https:, mailto:. HTML entities are decoded and whitespace /
 * control characters dropped first, the way a browser reads the attribute, so `java&#9;script:` or `&#58;` don't slip by.
 */
export function okHref(href: string) {
  const h = String(href ?? '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Math.min(+n, 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .toLowerCase()
  return /^\/(?![/\\])/.test(h) || h[0] === '#' || /^(?:https?|mailto):/.test(h)
}

/**
 * md() output → dashboard pages named in text or inline `code` (/metrics, /notes?n=4) become in-app links, links to a
 * page get class "in", links to other sites open in a new tab. Never touches code blocks or existing links' text.
 */
export function linkify(html: string, routes: Set<string>) {
  const parts = html.split(/(<[^>]*>)/)
  let pre = 0, a = 0
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i]!
    if (s[0] === '<') {
      const m = /^<(\/?)([a-z0-9]+)/i.exec(s)
      if (!m) continue
      const tag = m[2]!.toLowerCase(), close = !!m[1]
      if (tag === 'pre') pre = Math.max(0, pre + (close ? -1 : 1))
      else if (tag === 'a') {
        a = Math.max(0, a + (close ? -1 : 1))
        if (!close) {
          // a link whose target is not on the allowlist (javascript:, data:, …) stays as text without a href
          const hm = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(s)
          if (hm && !okHref(hm[1] ?? hm[2] ?? hm[3] ?? '')) { parts[i] = s.replace(hm[0], ''); continue }
          const h = hm?.[1] ?? ''
          if (/^\/(?!\/|api\/)/.test(h)) parts[i] = s.replace(/^<a/, '<a class="in"')
          else if (/^https?:\/\//i.test(h)) parts[i] = s.replace(/^<a/, '<a target="_blank" rel="noopener noreferrer"')
        }
      }
      continue
    }
    if (!s || pre || a) continue
    if (/^<code[\s>]/.test(parts[i - 1] ?? '') && parts[i + 1] === '</code>') {
      const w = WHOLE.exec(s)
      if (w && routes.has(w[1]!)) parts[i] = `<a class="in" href="${s}">${s}</a>`
    } else if (s.includes('/')) {
      parts[i] = s.replace(BARE, (m, p: string, q = '') => (routes.has(p) ? `<a class="in" href="${p}${q}">${m}</a>` : m))
    }
  }
  return parts.join('')
}

export interface CodeLabels { copy: string, wrap: string, panel: string, all: (n: number) => string, less: string }
const COLLAPSE = 18

/**
 * md() output → every code block in a box with a header (language, copy, wrap, optionally "open in panel").
 * Blocks over 18 lines collapse behind a show-all button, but not while the answer streams (it would jump around).
 * `state` = per block index the flags the reader set ('w' wrap, 'o' open), so a re-render keeps them.
 */
export function codeBlocks(html: string, o: { labels: CodeLabels, panel?: boolean, busy?: boolean, state?: Record<number, string> }) {
  const L = o.labels
  let n = 0
  return html.replace(/<pre>(<code[^>]*>)?([\s\S]*?)<\/pre>/g, (_m, open = '', body: string) => {
    const lang = /language-([^"\s]*)/.exec(open)?.[1] ?? ''
    const st = o.state?.[n++] ?? ''
    const lines = body.replace(/<\/code>\s*$/, '').replace(/\n$/, '').split('\n').length
    const long = !o.busy && lines > COLLAPSE, wrap = st.includes('w'), more = long && st.includes('o')
    return `<div class="code${wrap ? ' wrap' : ''}${long ? ' long' : ''}${more ? ' open' : ''}"><div class="ch"><span class="cl">${lang}</span><span class="cbs">`
      + `<button type="button" class="cb cp">${L.copy}</button><button type="button" class="cb cw" aria-pressed="${wrap}">${L.wrap}</button>`
      + `${o.panel ? `<button type="button" class="cb co">${L.panel}</button>` : ''}</span></div><pre>${open}${body}</pre>`
      + `${long ? `<button type="button" class="cm" data-more="${L.all(lines)}" data-less="${L.less}">${more ? L.less : L.all(lines)}</button>` : ''}</div>`
  })
}

/** linkify + codeBlocks with the viewer's language: one call for every place that draws an answer */
export function useAnswerRender() {
  const { t: tr } = useI18n()
  const routes = useAnswerRoutes()
  return (html: string, o: { busy?: boolean, panel?: boolean, state?: Record<number, string> } = {}) => {
    const out = codeBlocks(linkify(html, routes.value), {
      ...o, labels: { copy: tr('ask.copy'), wrap: tr('ask.wrap'), panel: tr('ask.panel'), all: n => tr('ask.showAll', { n }), less: tr('ask.showLess') },
    })
    // file cards (utils/filecards.ts) only once the answer is complete: a streaming re-render would restart the player
    return o.busy ? out : fileCards(out, { open: tr('ask.fileOpen'), dl: tr('ask.fileDownload') })
  }
}

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
  // default to the model that is held in VRAM (instant first token), not to the largest one
  watch(models, (m) => {
    if (m?.length && !m.some(x => x.name === model.value)) model.value = (m.find(x => x.warm) ?? m[0]).name
  }, { immediate: true })
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
// one running answer per scope, kept outside the component: leave the page mid-answer, come back, Stop still works
const controllers: Record<string, AbortController | null> = {}

export function useAsk(scope: string, turns: Ref<Turn[]>, onChange?: () => void, incognito?: () => boolean) {
  const { model, think, web, models, refreshModels } = useAskSettings()
  const busy = computed(() => turns.value.some(t => t.busy))

  async function ask(text: string) {
    text = text.trim()
    if (!text || busy.value) return
    const history = sinceClear(turns.value).filter(t => !t.error).flatMap(t => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.a }])
    turns.value.push({ q: text, a: '', r: '', tools: [], proposals: [], busy: true, at: Date.now() })
    const t = turns.value[turns.value.length - 1]!
    const ctl = controllers[scope] = new AbortController()
    let saved = 0
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ q: text, model: model.value, think: think.value, web: web.value, scope, history, ...(incognito?.() ? { incognito: true } : {}) }),
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
          let j: any
          try { j = JSON.parse(line) } catch { continue }
          if (j.r) t.r += j.r
          if (j.c) t.a += j.c
          if (j.proposal) t.proposals!.push({ ...j.proposal, state: 'idle' })
          if (j.tool) t.tools!.push({ name: j.tool, args: j.args })
          if (j.toolDone) { const x = t.tools!.findLast(v => v.name === j.toolDone && !v.done); if (x) { x.done = true; x.error = j.error } }
          if (j.sources) addSources(t, j.sources)
          if (j.error) t.error = j.error
          if (j.done) { t.model = j.model; t.tps = j.tps }
        }
        // every token would otherwise re-save (and re-sync) every chat: once a second is plenty mid-stream
        if (Date.now() - saved > 1000) { saved = Date.now(); onChange?.() }
      }
    } catch (e: any) {
      t.error = e.name === 'AbortError' ? 'stopped' : e.message
    } finally {
      t.busy = false
      if (controllers[scope] === ctl) controllers[scope] = null
      refreshModels()
      onChange?.()
    }
  }

  /** nothing runs until the owner clicks Run; then poll the job until it finishes */
  async function run(p: Proposal, after?: () => void) {
    p.state = 'running'
    // mirrored in the header's jobs tray, so it can be followed from any page
    const jobs = useRuns()
    const mirror = jobs.add({ name: p.action, args: p.args, page: 'ask' })
    try {
      p.job = await $fetch('/api/ai/action/run', { method: 'POST', body: { name: p.action, args: p.args } })
      Object.assign(mirror, { id: p.job.id, desc: p.job.desc })
      for (;;) {
        await new Promise(r => setTimeout(r, 1500))
        p.job = await $fetch('/api/ai/action/status', { query: { id: p.job.id } })
        mirror.log = p.job.log ?? []
        if (p.job.done) break
      }
      p.state = p.job.rc === 0 ? 'done' : 'failed'
      jobs.finish(mirror, p.job.rc)
    } catch (e: any) {
      p.job = { log: [e?.statusMessage || e?.message || 'failed'] }
      p.state = 'failed'
      jobs.finish(mirror, null, p.job.log[0])
    }
    after?.()
    onChange?.()
  }

  const stop = () => controllers[scope]?.abort()
  return { ask, run, stop, busy, model, think, web, models }
}
