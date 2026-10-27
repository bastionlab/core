<script setup lang="ts">
import type { Proposal, Turn } from '~/composables/useAsk'
// dock: open questions are shown by the page above its input instead of in the answer; here only what was picked
// canEdit / canFork: whether turn i's question can be edited and sent again / the chat branched after turn i
// extras: read aloud + save as note (the chat page) · a compare turn (t.cmp) is drawn by the page's #compare slot
const props = defineProps<{ turns: Turn[], retry?: boolean, dock?: boolean, canEdit?: (i: number) => boolean, canFork?: (i: number) => boolean, extras?: boolean }>()
const emit = defineEmits<{ run: [Proposal], answer: [string], retry: [], edit: [number], fork: [number], stop: [], nudge: [], note: [number], execute: [number] }>()
const { t: tr } = useI18n()
const { speak, speaking, loading: speakLoading, error: speakError } = useSpeak()

// the answer's actions: the three used most on this device up front, the rest behind ··· (idea from Odysseus)
interface Act { key: string, label: string, icon?: string, title?: string, run: () => void }
const USE = 'chat.acts'
const uses = ref<Record<string, number>>({})
onMounted(() => { try { uses.value = JSON.parse(localStorage.getItem(USE) || '{}') } catch {} })
const ORDER = ['copy', 'retry', 'edit', 'branch', 'speak', 'note', 'speakAll']
function acts(t: Turn, i: number): Act[] {
  const k = 't' + i
  const all: (Act | false)[] = [
    !!t.a && { key: 'copy', label: copied.value === 'a' + i ? tr('ask.copied') : tr('ask.copy'), icon: 'copy', run: () => copy(view(t).text, 'a' + i) },
    !!props.retry && i === props.turns.length - 1 && { key: 'retry', label: tr('ask.retry'), icon: 'refresh', run: () => emit('retry') },
    !!props.canEdit?.(i) && { key: 'edit', label: tr('ask.edit'), icon: 'edit', title: tr('ask.editHint'), run: () => emit('edit', i) },
    !!props.canFork?.(i) && { key: 'branch', label: tr('ask.branch'), icon: 'branch', title: tr('ask.branchHint'), run: () => emit('fork', i) },
    !!props.extras && !!t.a && { key: 'speak', label: speaking.value === k ? tr('ask.stopSpeak') : tr('ask.speak'), icon: speaking.value === k ? 'stop' : 'play', run: () => speak(k, view(t).text) },
    !!props.extras && !!t.a && t.a.length > 450 && speaking.value !== k && { key: 'speakAll', label: tr('ask.speakAll'), icon: 'play', run: () => speak(k, view(t).text, true) },
    !!props.extras && !!t.a && { key: 'note', label: tr('ask.note'), icon: 'note', run: () => emit('note', i) },
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
const view = (t: Turn) => splitQuestions(t.plan ? t.a.replace(/\n*PLAN READY\s*$/, '') : t.a, t.busy)
const picked = (t: Turn) => {
  const qs = view(t).qs ?? []
  const a = (j: number) => t.answered?.[j]?.join(', ') || '—'
  return qs.length === 1 ? a(0) : qs.map((q, j) => `${q.header || q.q}: ${a(j)}`).join(' · ')
}
// Claude can make dozens of tool calls in one answer: show the latest few, the rest behind a click
const SHOW = 6
const expanded = ref(new Set<number>())
const shown = (t: Turn, i: number) => (expanded.value.has(i) ? t.tools! : t.tools!.slice(-SHOW))

// code blocks get a copy button; clicks are caught once on the list instead of per block
// keys, tokens and passwords in it are blurred until tapped (utils/secrets.ts)
const html = (t: Turn) => {
  const { text, found } = hideSecrets(view(t).text)
  return showSecrets(md(text), found).replace(/<pre>/g, '<div class="code"><button type="button" class="cp">copy</button><pre>').replace(/<\/pre>/g, '</pre></div>')
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
  if (sec) return sec.classList.toggle('shown')
  // a link to a dashboard page (/notes?n=4) opens inside the app instead of reloading it
  const href = el.closest('.a a')?.getAttribute('href') ?? ''
  if (/^\/(?!\/|api\/)/.test(href)) { e.preventDefault(); return void navigateTo(href) }
  const b = el.closest('button.cp') as HTMLElement | null
  const pre = b?.nextElementSibling as HTMLElement | null
  if (!b || !pre) return
  copy(pre.innerText, '')
  b.textContent = 'copied ✓'
  setTimeout(() => (b.textContent = 'copy'), 1500)
}

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
  return s >= (t.tools?.some(x => !x.done) ? 300 : 120) ? s : 0
}
function activity(t: Turn) {
  const tl = t.tools?.findLast(x => !x.done)
  if (tl) return tl.label || tl.name
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
    <div v-else class="turn">
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
      <div v-if="t.a" class="a" v-html="html(t)" />
      <template v-if="dock && !t.busy && view(t).qs">
        <div v-if="t.answered" class="picked small"><span class="ok">✓</span> <span class="muted">Picked:</span> {{ picked(t) }}</div>
        <div v-else-if="i === turns.length - 1 && !t.error" class="picked small warn">❓ waiting for your answer below</div>
      </template>
      <AskQuestions
        v-else-if="!t.busy && view(t).qs" :qs="view(t).qs!" :answered="t.answered"
        :disabled="i !== turns.length - 1 || turns.some(x => x.busy)"
        @answer="(text, picked) => { t.answered = picked; emit('answer', text) }"
      />
      <div v-if="t.compacted && t.q !== '/compact'" class="cleared small faint">{{ $t('ask.compacted', { pre: kt(t.compacted.pre), post: kt(t.compacted.post) }) }}</div>
      <div v-if="t.busy" class="live small muted">
        <span class="spin" /><span class="what">{{ activity(t) }}</span><span class="faint">· {{ elapsed(t) }}</span>
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
          <span v-else class="pill" :class="{ ok: p.state === 'done', bad: p.state === 'failed' }">
            {{ p.state === 'running' ? 'running…' : p.state === 'done' ? 'done' : p.state === 'failed' ? `failed (exit ${p.job?.rc})` : 'dismissed' }}
          </span>
        </div>
        <div v-if="p.why && p.state === 'idle'" class="muted small">{{ p.why }}</div>
        <pre v-if="p.job?.log?.length" class="log small">{{ p.job.log.slice(-12).join('\n') }}</pre>
      </div>
      <div v-if="t.denied?.length && !t.busy" class="denied small">
        Read-only blocked {{ t.denied.length === 1 ? 'a change' : `${t.denied.length} changes` }}: <span class="mono">{{ t.denied.slice(0, 3).join(' · ') }}</span>. Switch on <b>Auto</b> to allow it.
      </div>
      <div v-if="t.error" class="small bad">{{ t.error }}</div>
      <div v-if="t.plan && !t.busy && !t.error && i === turns.length - 1 && !t.executed" class="plan">
        <button type="button" class="btn primary sm" @click="emit('execute', i)">⚡ {{ $t('ask.execute') }}</button>
        <span class="small muted">{{ $t('ask.executeHint') }}</span>
      </div>
      <div v-if="!t.busy && (t.model || t.a || t.error)" class="meta faint small">
        <span class="acts">
          <button
            v-for="a in (more.has(i) ? acts(t, i) : acts(t, i).slice(0, SHOWN))" :key="a.key" type="button" class="act ic" :title="a.title" @click="use(a)"
          ><Icon v-if="a.icon" :name="a.icon" :size="13" /> {{ a.label }}</button>
          <button v-if="!more.has(i) && acts(t, i).length > SHOWN" type="button" class="act" :title="$t('ask.more')" @click="more.add(i)">···</button>
        </span>
        {{ t.model }}<template v-if="t.tps"> · {{ t.tps.toFixed(1) }} tok/s</template><template v-if="t.effort"> · {{ t.effort }}</template><template v-if="t.secs"> · {{ t.secs }} s</template><span v-if="t.ct" :class="t.auto ? 'autotag' : ''"> · {{ t.auto ? '⚡ auto' : 'read-only' }}</span><template v-if="t.team"> · 👥</template><template v-if="t.plan"> · {{ $t('ask.planTag') }}</template>
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
.stall .btn { font-size: 12px; padding: 3px 9px; }
.act.ic { display: inline-flex; align-items: center; gap: 4px; }
.a :deep(.sec) { filter: blur(5px); cursor: pointer; user-select: none; transition: filter .15s; }
.a :deep(.sec.shown) { filter: none; user-select: text; }
.cleared { display: flex; align-items: center; gap: 10px; padding: 10px 0; }
.cleared::before, .cleared::after { content: ''; flex: 1; border-top: 1px dashed var(--line-2); }
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
.a :deep(table) { margin-bottom: 8px; font-size: 13px; }
.a :deep(h1), .a :deep(h2), .a :deep(h3) { font-size: 14px; margin: 10px 0 4px; }
.tools { display: flex; flex-wrap: wrap; gap: 6px; }
.tools .pill { gap: 6px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tools .more { cursor: pointer; font: inherit; }
.denied { border: 1px solid var(--warn-soft); background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-sm); padding: 6px 10px; overflow-wrap: anywhere; }
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
.proposal .btns { margin-left: auto; display: flex; gap: 6px; }
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
.act:hover { color: var(--text); border-color: var(--line); background: var(--panel-2); }
@media (pointer: coarse) { .act { padding: 6px 10px; } .a :deep(.cp) { padding: 4px 10px; font-size: 12px; opacity: 1; } }
.a :deep(.code) { position: relative; margin-bottom: 8px; }
.a :deep(.code pre) { margin: 0; }
.a :deep(.cp) { position: absolute; top: 5px; right: 5px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font: inherit; font-size: 11px; padding: 1px 7px; cursor: pointer; opacity: .75; }
.a :deep(.cp:hover) { opacity: 1; color: var(--text); }
.picked { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 6px 10px; background: var(--panel-2); overflow-wrap: anywhere; align-self: flex-start; }
.picked.warn { color: var(--warn); border-color: var(--warn-soft); background: var(--warn-soft); }
.pre { white-space: pre-wrap; max-height: 200px; overflow-y: auto; padding: 6px 0; }
</style>
