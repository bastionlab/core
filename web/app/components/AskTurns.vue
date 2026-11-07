<script setup lang="ts">
import type { Proposal, Turn } from '~/composables/useAsk'
// dock: open questions are shown by the page above its input instead of in the answer; here only what was picked
// canEdit / canFork: whether turn i's question can be edited and sent again / the chat branched after turn i
// extras: read aloud + save as note + compare (the chat page) · a compare turn (t.cmp) is drawn by the page's #compare slot
// codePanel: code blocks get an "open in panel" button that emits `code` (the page shows it); compare: ask turn i's question to several models
const props = defineProps<{ turns: Turn[], retry?: boolean, dock?: boolean, canEdit?: (i: number) => boolean, canFork?: (i: number) => boolean, extras?: boolean, codePanel?: boolean }>()
const emit = defineEmits<{ run: [Proposal], answer: [string], retry: [], edit: [number], fork: [number], stop: [], nudge: [], note: [number], execute: [number], remember: [number, string], skipMem: [number, string], speak: [string, string, boolean], code: [{ lang: string, text: string }], compare: [number] }>()
const { t: tr } = useI18n()
const { speak, speaking, loading: speakLoading, error: speakError } = useSpeak()

// the answer's actions: the three used most on this device up front, the rest behind ··· (idea from Odysseus)
interface Act { key: string, label: string, icon?: string, title?: string, run: () => void }
const USE = 'chat.acts'
const uses = ref<Record<string, number>>({})
onMounted(() => { try { uses.value = JSON.parse(localStorage.getItem(USE) || '{}') } catch {} })
const ORDER = ['copy', 'retry', 'edit', 'branch', 'speak', 'note', 'compare', 'speakAll']
function acts(t: Turn, i: number): Act[] {
  const k = 't' + i
  const all: (Act | false)[] = [
    !!t.a && { key: 'copy', label: copied.value === 'a' + i ? tr('ask.copied') : tr('ask.copy'), icon: 'copy', run: () => copy(view(t).text, 'a' + i) },
    !!props.retry && i === props.turns.length - 1 && { key: 'retry', label: tr('ask.retry'), icon: 'refresh', run: () => emit('retry') },
    !!props.canEdit?.(i) && { key: 'edit', label: tr('ask.edit'), icon: 'edit', title: tr('ask.editHint'), run: () => emit('edit', i) },
    !!props.canFork?.(i) && { key: 'branch', label: tr('ask.branch'), icon: 'branch', title: tr('ask.branchHint'), run: () => emit('fork', i) },
    !!props.extras && !!t.a && { key: 'speak', label: speaking.value === k ? tr('ask.stopSpeak') : tr('ask.speak'), icon: speaking.value === k ? 'stop' : 'play', run: () => emit('speak', k, view(t).text, false) },
    !!props.extras && !!t.a && t.a.length > 450 && speaking.value !== k && { key: 'speakAll', label: tr('ask.speakAll'), icon: 'play', run: () => emit('speak', k, view(t).text, true) },
    !!props.extras && !!t.a && { key: 'note', label: tr('ask.note'), icon: 'note', run: () => emit('note', i) },
    !!props.extras && !!t.a && !t.cmp && !!t.q && t.q !== '/compact' && { key: 'compare', label: tr('ask.compare'), icon: 'scale', run: () => emit('compare', i) },
  ]
  return (all.filter(Boolean) as Act[]).sort((a, b) => (uses.value[b.key] ?? 0) - (uses.value[a.key] ?? 0) || ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
}
function use(a: Act) {
  a.run()
  uses.value[a.key] = (uses.value[a.key] ?? 0) + 1
  try { localStorage.setItem(USE, JSON.stringify(uses.value)) } catch {}
}
const more = ref(new Set<number>())
const SHOWN = 3
const kt2 = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const usageLine = (t: Turn) => Object.entries(t.usage ?? {}).sort((a, b) => b[1].tok - a[1].tok).map(([m, u]) => `${m} ${kt2(u.tok)}`).join(' · ')
const usd = (t: Turn) => Object.values(t.usage ?? {}).reduce((s, u) => s + u.usd, 0)
// a plan's closing marker is for the page (Execute button), not for reading
// (a Claude ```action block at the start of a line, even half-streamed, is hidden while the turn runs: when it ends
// useClaude turns the valid ones into Run cards and cuts them; one that does not parse stays visible)
const ACTION = /^```action[ \t]*\n[\s\S]*?(?:^```[ \t]*$|(?![\s\S]))/gm
// (memoised per turn: the template asks for it several times a render and a running answer re-renders every second)
const viewMemo = new WeakMap<Turn, { a: string, plan: unknown, busy: unknown, v: ReturnType<typeof splitQuestions> }>()
const view = (t: Turn) => {
  const raw = toRaw(t), m = viewMemo.get(raw)
  if (m && m.a === t.a && m.plan === t.plan && m.busy === t.busy) return m.v
  const a = t.plan ? t.a.replace(/\n*PLAN READY\s*$/, '') : t.a
  const v = splitQuestions(t.busy ? a.replace(ACTION, '') : a, t.busy)
  viewMemo.set(raw, { a: t.a, plan: t.plan, busy: t.busy, v })
  return v
}
const picked = (t: Turn) => {
  const qs = view(t).qs ?? []
  const a = (j: number) => t.answered?.[j]?.join(', ') || '—'
  return qs.length === 1 ? a(0) : qs.map((q, j) => `${q.header || q.q}: ${a(j)}`).join(' · ')
}
// Claude can make dozens of tool calls in one answer: show the latest few, the rest behind a click
const SHOW = 6
const expanded = ref(new Set<number>())
// web pages the answer used: first 3 as chips, the rest behind "+N"
const SRC = 3
const srcOpen = ref(new Set<number>())
const srcShown = (t: Turn, i: number) => (srcOpen.value.has(i) ? t.sources! : t.sources!.slice(0, SRC))
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
const shown = (t: Turn, i: number) => (expanded.value.has(i) ? t.tools! : t.tools!.slice(-SHOW))

// code blocks get a header (copy / wrap / open in panel) and long ones fold, dashboard pages become links (useAsk.ts);
// clicks are caught once on the list instead of per block
// keys, tokens and passwords in it are blurred until tapped (utils/secrets.ts)
const render = useAnswerRender()
// what the reader did to a block (wrapped 'w', unfolded 'o') survives the re-render of a streaming answer
const codeState = new WeakMap<Turn, Record<number, string>>()  // keyed by the raw turn (toRaw)
// a revealed secret ('sec shown') is remembered by its text, so a streaming re-render keeps it open
const revealed = new WeakMap<Turn, Set<string>>()
const escSec = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
// markdown runs again only when something that changes the output changed (text, busy, plan, the reader's
// wrap/unfold/reveal, panel button, language, known routes): finished turns stay untouched while another one streams
const { locale } = useI18n()
const routes = useAnswerRoutes()
const htmlMemo = new WeakMap<Turn, { k: unknown[], h: string }>()
const html = (t: Turn) => {
  const raw = toRaw(t), st = codeState.get(raw), rv = revealed.get(raw)
  const k = [t.a, t.plan, t.busy, props.codePanel, st && JSON.stringify(st), rv && [...rv].join('\u0000'), locale.value, routes.value]
  const m = htmlMemo.get(raw)
  if (m && m.k.every((x, n) => x === k[n])) return m.h
  const { text, found } = hideSecrets(stripFiles(view(t).text))
  let h = render(showSecrets(md(text), found), { busy: t.busy, panel: props.codePanel, state: st })
  if (rv?.size) h = h.replace(/<span class="sec" title="tap to show">([^<]*)<\/span>/g, (m0, v) => (rv.has(v) ? `<span class="sec shown" title="tap to show">${v}</span>` : m0))
  htmlMemo.set(raw, { k, h })
  return h
}
const copied = ref('')
async function copy(text: string, key: string) {
  try { await navigator.clipboard.writeText(text) } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text })
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove()
  }
  copied.value = key
  setTimeout(() => copied.value === key && (copied.value = ''), 1500)
}
function onClick(e: MouseEvent) {
  const el = e.target as HTMLElement
  const sec = el.closest('.a .sec')
  if (sec) {
    const on = sec.classList.toggle('shown'), ans = sec.closest('.a') as HTMLElement | null, t = props.turns[Number(ans?.dataset.i)]
    if (t) {
      const set = revealed.get(toRaw(t)) ?? new Set<string>(), v = escSec(sec.textContent ?? '')
      on ? set.add(v) : set.delete(v)
      revealed.set(toRaw(t), set)
    }
    return
  }
  // a link to a dashboard page (/notes?n=4) opens inside the app instead of reloading it (other sites open in a new tab)
  const href = el.closest('.a a')?.getAttribute('href') ?? ''
  if (/^\/(?!\/|api\/)/.test(href)) { e.preventDefault(); return void navigateTo(href) }
  const b = el.closest('.code button') as HTMLElement | null
  const box = b?.closest('.code') as HTMLElement | null
  const pre = box?.querySelector('pre')
  if (!b || !box || !pre) return
  const flag = (f: string, on: boolean) => {
    const ans = box.closest('.a') as HTMLElement | null, t = props.turns[Number(ans?.dataset.i)]
    if (!ans || !t) return
    const idx = [...ans.querySelectorAll('.code')].indexOf(box), st = codeState.get(toRaw(t)) ?? {}
    st[idx] = (st[idx] ?? '').replace(f, '') + (on ? f : '')
    codeState.set(toRaw(t), st)
  }
  if (b.classList.contains('cp')) {
    copy(pre.textContent ?? '', '')
    b.textContent = tr('ask.copied')
    setTimeout(() => (b.textContent = tr('ask.copy')), 1500)
  } else if (b.classList.contains('cw')) {
    const on = box.classList.toggle('wrap')
    b.setAttribute('aria-pressed', String(on))
    flag('w', on)
  } else if (b.classList.contains('cm')) {
    const on = box.classList.toggle('open')
    b.textContent = (on ? b.dataset.less : b.dataset.more) ?? ''
    flag('o', on)
  } else if (b.classList.contains('co')) {
    emit('code', { lang: box.querySelector('.cl')?.textContent ?? '', text: pre.textContent ?? '' })
  }
}

// a turn that arrives while this chat is open rises in; opening or switching a chat and a sync pull (both hand us
// another array) do not animate what is already there
const rise = new WeakSet<Turn>()
let seen: Turn[] | null = null, seenLen = 0
watch(() => props.turns.length, (n) => {
  const arr = toRaw(props.turns)
  if (arr === seen && n > seenLen) for (let i = seenLen; i < n; i++) rise.add(toRaw(arr[i]!))
  seen = arr; seenLen = n
}, { flush: 'pre', immediate: true })
watch(() => props.turns, (a) => { seen = toRaw(a); seenLen = a.length; })

// while an answer runs: what it is doing right now and for how long
const now = ref(Date.now())
let timer: any
watchEffect(() => {
  const running = props.turns.some(t => t.busy)
  if (running && !timer) timer = setInterval(() => (now.value = Date.now()), 1000)
  else if (!running && timer) { clearInterval(timer); timer = null }
})
onUnmounted(() => clearInterval(timer))
const kt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const clock = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
const elapsed = (t: Turn) => clock(Math.max(0, Math.round((now.value - (t.at ?? now.value)) / 1000)))
// no sign of life for a while (longer while a command runs): maybe it hangs, offer Stop / a nudge (idea from Odysseus)
function quiet(t: Turn) {
  if (!t.busy || !t.ct) return 0
  const s = Math.round((now.value - (t.last ?? t.at ?? now.value)) / 1000)
  return s >= (t.tools?.some(x => !x.done) || running(t) ? 300 : 120) ? s : 0
}
// long jobs: step count (from the todo list) and an ETA, only after 2 minutes and only when known
function eta(t: Turn) {
  const p = t.progress
  if (!t.busy || !p?.total || (now.value - (t.at ?? now.value)) < 120000) return ''
  const m = p.etaSeconds == null ? '' : p.etaSeconds < 60 ? ' · <1 min left' : ` · ~${Math.ceil(p.etaSeconds / 60)} min left`
  return `step ${Math.min(p.done + 1, p.total)}/${p.total}${m}`
}
// background shells the turn started (it stays open while they run): count + tap-to-open live output
const running = (t: Turn) => (t.bg ?? []).filter(b => b.status === 'running').length
const openBg = ref<string | null>(null), bgText = ref('')
const bgOf = (t: Turn, id: string | null) => (t.bg ?? []).find(b => b.id === id)
// the command the shell runs: the Bash call that started it (its tool_use input)
const bgCmd = (t: Turn, id: string | null) => {
  const b = bgOf(t, id), tl = t.tools?.find(x => x.id === b?.tuid)
  return tl?.args?.command || b?.desc || id || ''
}
const bgOut = (t: Turn) => bgOf(t, openBg.value)?.out
let bgTimer: any
async function pollBg(b: { out?: string }) {
  if (!b.out) { bgText.value = ''; return }
  try { bgText.value = (await $fetch<{ text: string }>('/api/claude/task', { query: { file: b.out } })).text } catch { bgText.value = '(output not readable)' }
}
function toggleBg(b: { id: string, out?: string, status: string }) {
  clearInterval(bgTimer)
  if (openBg.value === b.id) { openBg.value = null; return }
  openBg.value = b.id
  pollBg(b)
  bgTimer = setInterval(() => { if (b.status === 'running') pollBg(b) }, 3000)
}
onUnmounted(() => clearInterval(bgTimer))
function activity(t: Turn) {
  const tl = t.tools?.findLast(x => !x.done)
  if (tl) return tl.label || tl.name
  if (running(t) && !t.fin) return 'waiting for background shells'
  if (t.a) return 'writing'
  if (t.r) return 'thinking'
  return t.ct ? 'starting' : 'loading the model'
}
</script>

<template>
  <div class="turns" @click="onClick">
    <template v-for="(t, i) in turns" :key="i">
    <div v-if="t.clear" class="cleared small faint">context cleared</div>
    <div v-else-if="t.q === '/compact' && !t.busy && !t.error" class="cleared small faint">
      {{ t.compacted ? $t('ask.compacted', { pre: kt(t.compacted.pre), post: kt(t.compacted.post) }) : $t('ask.compactedShort') }}
    </div>
    <div v-else-if="t.cmp" class="turn"><slot name="compare" :turn="t" :index="i" /></div>
    <div v-else class="turn" :class="{ rise: rise.has(toRaw(t)) }">
      <div v-if="t.imgs?.length" class="qimgs">
        <a v-for="n in t.imgs" :key="n" :href="`/api/chat/img/${n}`" target="_blank">
          <img v-if="!n.includes('-')" :src="`/api/chat/img/${n}`" alt="screenshot">
          <span v-else class="fchip small"><Icon name="clip" :size="13" /> {{ n.replace(/^[a-f0-9]{24}-/, '') }}</span>
        </a>
      </div>
      <div v-if="t.q" class="q">{{ t.q }}</div>
      <div v-if="t.tools?.length" class="tools small muted">
        <button v-if="t.tools.length > SHOW && !expanded.has(i)" class="pill more" @click="expanded.add(i)">+{{ t.tools.length - SHOW }} earlier</button>
        <span v-for="(tl, j) in shown(t, i)" :key="j" class="pill" :class="{ bad: tl.error }" :title="tl.label">
          <span class="dot" :class="tl.error ? 'bad' : tl.done || !t.busy ? 'ok' : 'warn'" />
          {{ tl.label ? tl.label : tl.name === 'web_search' ? `searched “${tl.args?.query}”` : tl.name === 'fetch_page' ? `read ${(tl.args?.url || '').replace(/^https?:\/\//, '').slice(0, 40)}` : tl.name === 'weather' ? `weather ${tl.args?.location || ''}` : tl.name }}{{ tl.error ? ` — ${tl.error}` : '' }}
        </span>
      </div>
      <details v-if="t.r" class="reason small muted"><summary>reasoning{{ t.busy && !t.a ? '…' : '' }}</summary><div class="pre">{{ t.r }}</div></details>
      <div v-if="t.a" class="a" :data-i="i" v-html="html(t)" />
      <div v-if="t.sources?.length && !t.busy" class="sources small">
        <span class="faint">{{ $t('ask.sources') }}</span>
        <a v-for="s in srcShown(t, i)" :key="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="pill src">
          <span class="st">{{ s.title || host(s.url) }}</span><span class="faint">{{ host(s.url) }}</span>
        </a>
        <button v-if="t.sources.length > SRC && !srcOpen.has(i)" type="button" class="pill more" @click="srcOpen.add(i)">+{{ t.sources.length - SRC }}</button>
      </div>
      <div v-if="t.mem?.length && !t.busy" class="memq small">
        <span class="faint">{{ $t('memory.ask') }}</span>
        <span v-for="f in t.mem" :key="f" class="pill memchip">
          <span class="mt">{{ f }}</span>
          <button type="button" class="mb ok" :title="$t('memory.save')" @click="emit('remember', i, f)" :aria-label="$t('memory.save')"><Icon name="check" :size="16"/></button>
          <button type="button" class="mb" :title="$t('memory.dismiss')" @click="emit('skipMem', i, f)" :aria-label="$t('memory.dismiss')"><Icon name="x" :size="16"/></button>
        </span>
      </div>
      <template v-if="dock && !t.busy && view(t).qs">
        <div v-if="t.answered" class="picked small"><span class="ok"><Icon name="check" :size="14"/></span> <span class="muted">Picked:</span> {{ picked(t) }}</div>
        <div v-else-if="i === turns.length - 1 && !t.error" class="picked small warn"><Icon name="circle-help" :size="14"/> waiting for your answer below</div>
      </template>
      <AskQuestions
        v-else-if="!t.busy && view(t).qs" :qs="view(t).qs!" :answered="t.answered"
        :disabled="i !== turns.length - 1 || turns.some(x => x.busy)"
        @answer="(text, picked) => { t.answered = picked; emit('answer', text) }"
      />
      <div v-if="t.compacted && t.q !== '/compact'" class="cleared small faint">{{ $t('ask.compacted', { pre: kt(t.compacted.pre), post: kt(t.compacted.post) }) }}</div>
      <div v-if="t.busy" class="live small muted">
        <span class="spin" /><span class="what">{{ activity(t) }}</span><span v-if="running(t)" class="faint">· {{ running(t) }} background</span><span class="faint">· {{ elapsed(t) }}</span><span v-if="eta(t)" class="faint eta">· {{ eta(t) }}</span>
      </div>
      <div v-if="t.bg?.length" class="bgs small">
        <button v-for="b in t.bg" :key="b.id" type="button" class="pill" :class="{ warn: b.status === 'running' && t.busy }" @click="toggleBg(b)">
          <span class="dot" :class="b.status === 'running' && t.busy ? 'warn' : b.status === 'completed' ? 'ok' : 'bad'" />{{ b.desc }}
        </button>
        <div v-if="t.bg.some(b => b.id === openBg)" class="bgout small">
          <div class="mono cmd">$ {{ bgCmd(t, openBg) }}</div>
          <pre class="mono">{{ bgText || (bgOut(t) ? 'no output yet' : 'output file not reported yet') }}</pre>
        </div>
      </div>
      <div v-if="quiet(t)" class="stall small">
        <span>{{ $t('ask.quiet', { time: clock(quiet(t)) }) }}</span>
        <button type="button" class="btn ghost sm" @click="emit('nudge')">{{ $t('ask.nudge') }}</button>
        <button type="button" class="btn ghost sm" @click="emit('stop')">{{ $t('ask.stop') }}</button>
      </div>
      <div v-for="(p, j) in t.proposals" :key="'p' + j" class="proposal" :class="[p.state, { danger: p.desc?.startsWith('FORCE:') }]">
        <div class="head">
          <span class="what"><b>{{ p.desc }}</b></span>
          <span v-if="p.state === 'idle'" class="btns">
            <button class="btn primary sm" :class="{ danger: p.desc?.startsWith('FORCE:') }" @click="emit('run', p)">
              {{ p.desc?.startsWith('FORCE:') ? 'Run anyway' : 'Run' }}
            </button>
            <button class="btn ghost sm" @click="p.state = 'dismissed'">Dismiss</button>
          </span>
          <span v-else-if="p.state === 'sent'" class="btns">
            <span class="pill">{{ $t('ask.proposalSent') }}</span>
            <button class="btn ghost sm" @click="p.state = 'dismissed'">Dismiss</button>
          </span>
          <span v-else class="pill" :class="{ ok: p.state === 'done', bad: p.state === 'failed' }">
            {{ p.state === 'running' ? 'running…' : p.state === 'done' ? 'done' : p.state === 'failed' ? `failed (exit ${p.job?.rc})` : 'dismissed' }}
          </span>
        </div>
        <div v-if="p.why && p.state === 'idle'" class="muted small">{{ p.why }}</div>
        <pre v-if="p.job?.log?.length" class="log small">{{ p.job.log.slice(-12).join('\n') }}</pre>
      </div>
      <div v-if="t.denied?.length && !t.busy" class="denied small">
        <template v-if="t.auto">Auto's safety check blocked {{ t.denied.length === 1 ? 'a step' : `${t.denied.length} steps` }}: <span class="mono">{{ t.denied.slice(0, 3).join(' · ') }}</span>.</template>
        <template v-else>Read-only blocked {{ t.denied.length === 1 ? 'a change' : `${t.denied.length} changes` }}: <span class="mono">{{ t.denied.slice(0, 3).join(' · ') }}</span>. Switch on <b>Auto</b> to allow it.</template>
      </div>
      <div v-if="t.error" class="small bad">{{ t.error }}</div>
      <div v-if="t.plan && !t.busy && !t.error && i === turns.length - 1 && !t.executed" class="plan">
        <button type="button" class="btn primary sm" @click="emit('execute', i)"><Icon name="zap" :size="16"/> {{ $t('ask.execute') }}</button>
        <span class="small muted">{{ $t('ask.executeHint') }}</span>
      </div>
      <div v-if="!t.busy && (t.model || t.a || t.error)" class="meta faint small">
        <span class="acts">
          <button
            v-for="a in (more.has(i) ? acts(t, i) : acts(t, i).slice(0, SHOWN))" :key="a.key" type="button" class="act ic" :title="a.title" @click="use(a)"
          ><Icon v-if="a.icon" :name="a.icon" :size="13" /> {{ a.label }}</button>
          <button v-if="!more.has(i) && acts(t, i).length > SHOWN" type="button" class="act" :title="$t('ask.more')" @click="more.add(i)">···</button>
        </span>
        {{ t.model }}<template v-if="t.tps"> · {{ t.tps.toFixed(1) }} tok/s</template><template v-if="t.effort"> · {{ t.effort }}</template><template v-if="t.secs"> · {{ t.secs }} s</template><span v-if="t.ct" :class="t.auto ? 'autotag' : ''"> · <Icon v-if="t.auto" name="zap" :size="12"/>{{ t.auto ? ' auto' : 'read-only' }}</span><template v-if="t.team"> · <Icon name="users" :size="12"/></template><template v-if="t.plan"> · {{ $t('ask.planTag') }}</template>
        <div v-if="t.usage && Object.keys(t.usage).length" class="usage" :title="$t('ask.usageHint', { usd: usd(t).toFixed(2) })">{{ usageLine(t) }}</div>
      </div>
      <div v-if="speakError && speaking === '' && i === turns.length - 1" class="small bad">{{ speakError }}</div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.plan { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border: 1px solid var(--warn-soft); border-radius: var(--radius-sm); padding: 8px 10px; }
.usage { flex-basis: 100%; font-variant-numeric: tabular-nums; }
.stall { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; border: 1px solid var(--warn-soft); background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-sm); padding: 5px 8px 5px 10px; }
.bgs { display: flex; flex-wrap: wrap; gap: 6px; }
.bgs .pill { cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bgout { flex-basis: 100%; max-height: 260px; overflow: auto; background: var(--term-bg); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px; }
.bgout .cmd { white-space: pre-wrap; word-break: break-all; color: var(--text); margin-bottom: 6px; }
.bgout pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
.stall .btn { font-size: 12px; padding: 3px 9px; }
.act.ic { display: inline-flex; align-items: center; gap: 4px; }
.a :deep(.sec) { filter: blur(5px); cursor: pointer; user-select: none; transition: filter .15s; }
.a :deep(.sec.shown) { filter: none; user-select: text; }
.cleared { display: flex; align-items: center; gap: 10px; padding: 10px 0; }
.cleared::before, .cleared::after { content: ''; flex: 1; border-top: 1px dashed var(--line-2); }
.turn.rise { animation: turn-rise var(--dur) var(--ease-out) backwards; }
@keyframes turn-rise { from { opacity: 0; transform: translateY(6px); } }
.turn { padding: 12px 0; display: flex; flex-direction: column; gap: 8px; }
.qimgs { align-self: flex-end; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: 85%; }
.qimgs .fchip { display: flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel-2); color: var(--text); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qimgs img { display: block; max-height: 160px; max-width: min(240px, 100%); border-radius: 10px; border: 1px solid var(--line); }
.q { align-self: flex-end; max-width: 85%; background: var(--panel-2); border: 1px solid var(--line); padding: 7px 12px; border-radius: 12px 12px 4px 12px; overflow-wrap: anywhere; white-space: pre-wrap; }
.a { line-height: 1.55; overflow-wrap: anywhere; }
.a :deep(p) { margin: 0 0 8px; }
.a :deep(ul), .a :deep(ol) { margin: 0 0 8px; padding-left: 20px; }
.a :deep(a) { text-decoration: underline; text-underline-offset: 2px; }
.a :deep(pre) { background: var(--bg); border: 1px solid var(--line); padding: 8px 10px; border-radius: var(--radius-sm); overflow-x: auto; }
.a :deep(code) { font-family: var(--mono); font-size: 12.5px; }
.a :deep(:not(pre) > code) { background: var(--panel-2); padding: 1px 4px; border-radius: 4px; }
.a :deep(table) { display: block; max-width: 100%; overflow-x: auto; margin-bottom: 8px; font-size: 13px; }
.a :deep(h1), .a :deep(h2), .a :deep(h3) { font-size: 14px; margin: 10px 0 4px; }
.tools { display: flex; flex-wrap: wrap; gap: 6px; }
.tools .pill { gap: 6px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tools .more { cursor: pointer; font: inherit; }
.sources { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sources .src { gap: 6px; max-width: 100%; min-width: 0; text-decoration: none; color: var(--text); }
.sources .st { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
.sources .more { cursor: pointer; font: inherit; }
@media (pointer: coarse) { .sources .pill { min-height: 32px; } }
.denied { border: 1px solid var(--warn-soft); background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-sm); padding: 6px 10px; overflow-wrap: anywhere; }
.memq { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
.memchip { display: flex; align-items: flex-start; gap: 4px; max-width: 100%; white-space: normal; border-radius: var(--radius-sm); padding: 4px 4px 4px 10px; font-size: 12.5px; color: var(--text); }
.memchip .mt { flex: 1; min-width: 0; overflow-wrap: anywhere; line-height: 1.45; padding-top: 3px; }
.memchip .mb { flex-shrink: 0; }
.memchip .mb { border: 0; background: none; color: var(--muted); cursor: pointer; font: inherit; padding: 2px 6px; }
.memchip .mb.ok { color: var(--ok); }
@media (pointer: coarse) { .memchip .mb { min-width: 32px; min-height: 32px; } }
.autotag { color: var(--warn); }
.proposal { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: var(--radius-sm); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--panel-2); }
.proposal.done { border-left-color: var(--ok); }
.proposal.failed { border-left-color: var(--bad); }
.proposal.dismissed { opacity: .55; }
/* a proposal that would destroy work the owner cannot get back is not an ordinary one */
.proposal.danger { border-color: var(--bad); border-left-color: var(--bad); }
.proposal.danger .what { color: var(--bad); }
.btn.danger { background: var(--bad); border-color: var(--bad); color: var(--bg); }
.proposal .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.proposal .btns { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.log { white-space: pre-wrap; max-height: 160px; overflow-y: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; margin: 0; font-family: var(--mono); }
.reason summary { cursor: pointer; }
.live { display: flex; align-items: center; gap: 7px; min-width: 0; }
.live .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.live .faint { flex-shrink: 0; }
.spin { width: 12px; height: 12px; flex-shrink: 0; border-radius: 50%; border: 2px solid var(--line-2); border-top-color: var(--accent); animation: tspin .8s linear infinite; }
@keyframes tspin { to { transform: rotate(360deg) } }
.meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0 4px; }
.acts { display: inline-flex; gap: 2px; margin-right: 6px; }
.act { background: none; border: 1px solid transparent; border-radius: 6px; color: var(--muted); font: inherit; padding: 1px 6px; cursor: pointer; }
.act { transition: transform var(--dur-fast) var(--ease-out), color var(--dur-fast), background var(--dur-fast); }
.act:active { transform: scale(.94); }
@media (hover: hover) { .act:hover { color: var(--text); border-color: var(--line); background: var(--panel-2); } }
@media (pointer: coarse) { .act { padding: 6px 10px; } }
.picked { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 6px 10px; background: var(--panel-2); overflow-wrap: anywhere; align-self: flex-start; }
.picked.warn { color: var(--warn); border-color: var(--warn-soft); background: var(--warn-soft); }
.pre { white-space: pre-wrap; max-height: 200px; overflow-y: auto; padding: 6px 0; }
</style>

<style>
/* code blocks and in-app links inside rendered answers: global because the chat's compare panes (CompareTurn) draw them too */
.turns .a .code { margin: 0 0 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); overflow: hidden; }
.turns .a .code .ch { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 1px 4px 1px 10px; background: var(--panel-2); border-bottom: 1px solid var(--line); }
.turns .a .code .cl { flex: 1; min-width: 0; font: 11.5px var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.turns .a .code .cbs { display: flex; gap: 2px; flex-shrink: 0; margin-left: auto; }
.turns .a .code .cb { background: none; border: 1px solid transparent; border-radius: 5px; color: var(--muted); font: inherit; font-size: 11.5px; padding: 2px 8px; cursor: pointer; }
.turns .a .code .cb:active { transform: scale(.94); }
@media (hover: hover) { .turns .a .code .cb:hover { color: var(--text); border-color: var(--line); } }
.turns .a .code .cb[aria-pressed="true"] { color: var(--accent); border-color: var(--accent-soft); background: var(--accent-soft); }
.turns .a .code pre { margin: 0; border: 0; border-radius: 0; line-height: 1.5; }
.turns .a .code.wrap pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.turns .a .code.long:not(.open) pre { max-height: calc(16 * 1.5em + 16px); overflow-y: hidden; }
.turns .a .code .cm { position: relative; display: block; width: 100%; border: 0; border-top: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12px; padding: 6px 10px; cursor: pointer; }
@media (hover: hover) { .turns .a .code .cm:hover { color: var(--text); } }
.turns .a .code.long:not(.open) .cm::before { content: ''; position: absolute; left: 0; right: 0; bottom: 100%; height: 40px; background: linear-gradient(to bottom, transparent, var(--bg)); pointer-events: none; }
.turns .a a.in { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-soft); }
@media (pointer: coarse) {
  .turns .a .code .ch { min-height: 36px; }
  .turns .a .code .cb { min-height: 32px; min-width: 40px; padding: 4px 10px; font-size: 12px; }
  .turns .a .code .cm { min-height: 36px; }
}
</style>
