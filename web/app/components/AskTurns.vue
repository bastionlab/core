<script setup lang="ts">
import type { Proposal, Turn } from '~/composables/useAsk'
// dock: open questions are shown by the page above its input instead of in the answer; here only what was picked
const props = defineProps<{ turns: Turn[], retry?: boolean, dock?: boolean }>()
const emit = defineEmits<{ run: [Proposal], answer: [string], retry: [] }>()
const view = (t: Turn) => splitQuestions(t.a, t.busy)
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
const html = (t: Turn) => md(view(t).text).replace(/<pre>/g, '<div class="code"><button type="button" class="cp">copy</button><pre>').replace(/<\/pre>/g, '</pre></div>')
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
  const b = (e.target as HTMLElement).closest('button.cp') as HTMLElement | null
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
const clock = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
const elapsed = (t: Turn) => clock(Math.max(0, Math.round((now.value - (t.at ?? now.value)) / 1000)))
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
    <div v-if="t.clear" class="cleared small faint">context cleared · the model forgets everything above</div>
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
      <div v-if="t.busy" class="live small muted">
        <span class="spin" /><span class="what">{{ activity(t) }}</span><span class="faint">· {{ elapsed(t) }}</span>
      </div>
      <div v-for="(p, j) in t.proposals" :key="'p' + j" class="proposal" :class="[p.state, { danger: p.desc?.startsWith('FORCE:') }]">
        <div class="head">
          <span class="what"><b>{{ p.desc }}</b></span>
          <span v-if="p.state === 'idle'" class="btns">
            <button class="btn primary small" :class="{ danger: p.desc?.startsWith('FORCE:') }" @click="emit('run', p)">
              {{ p.desc?.startsWith('FORCE:') ? 'Run anyway' : 'Run' }}
            </button>
            <button class="btn ghost small" @click="p.state = 'dismissed'">Dismiss</button>
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
      <div v-if="!t.busy && (t.model || t.a || t.error)" class="meta faint small">
        <span class="acts">
          <button v-if="t.a" type="button" class="act" title="copy the answer" @click="copy(view(t).text, 'a' + i)">{{ copied === 'a' + i ? '✓ copied' : 'copy' }}</button>
          <button v-if="retry && i === turns.length - 1" type="button" class="act" title="ask the same question again" @click="emit('retry')">↻ retry</button>
        </span>
        {{ t.model }}<template v-if="t.tps"> · {{ t.tps.toFixed(1) }} tok/s</template><template v-if="t.effort"> · {{ t.effort }}</template><template v-if="t.secs"> · {{ t.secs }} s</template><span v-if="t.ct" :class="t.auto ? 'autotag' : ''"> · {{ t.auto ? '⚡ auto' : 'read-only' }}</span>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
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
.a :deep(pre) { background: var(--bg); border: 1px solid var(--line); padding: 8px 10px; border-radius: 7px; overflow-x: auto; }
.a :deep(code) { font-family: var(--mono); font-size: 12.5px; }
.a :deep(:not(pre) > code) { background: var(--panel-2); padding: 1px 4px; border-radius: 4px; }
.a :deep(table) { margin-bottom: 8px; font-size: 13px; }
.a :deep(h1), .a :deep(h2), .a :deep(h3) { font-size: 14px; margin: 10px 0 4px; }
.tools { display: flex; flex-wrap: wrap; gap: 6px; }
.tools .pill { gap: 6px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tools .more { cursor: pointer; font: inherit; }
.denied { border: 1px solid var(--warn-soft); background: var(--warn-soft); color: var(--warn); border-radius: 8px; padding: 6px 10px; overflow-wrap: anywhere; }
.autotag { color: var(--warn); }
.proposal { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--panel-2); }
.proposal.done { border-left-color: var(--ok); }
.proposal.failed { border-left-color: var(--bad); }
.proposal.dismissed { opacity: .55; }
/* a proposal that would destroy work the owner cannot get back is not an ordinary one */
.proposal.danger { border-color: var(--bad); border-left-color: var(--bad); }
.proposal.danger .what { color: var(--bad); }
.btn.danger { background: var(--bad); border-color: var(--bad); color: #0a0c10; }
.proposal .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.proposal .btns { margin-left: auto; display: flex; gap: 6px; }
.proposal .btn.small { padding: 3px 10px; font-size: 12px; }
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
.a :deep(.code) { position: relative; margin-bottom: 8px; }
.a :deep(.code pre) { margin: 0; }
.a :deep(.cp) { position: absolute; top: 5px; right: 5px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font: inherit; font-size: 11px; padding: 1px 7px; cursor: pointer; opacity: .75; }
.a :deep(.cp:hover) { opacity: 1; color: var(--text); }
.picked { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; background: var(--panel-2); overflow-wrap: anywhere; align-self: flex-start; }
.picked.warn { color: var(--warn); border-color: var(--warn-soft); background: var(--warn-soft); }
.pre { white-space: pre-wrap; max-height: 200px; overflow-y: auto; padding: 6px 0; }
</style>
