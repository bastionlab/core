<script setup lang="ts">
import type { Question } from '~/utils/questions'
const props = defineProps<{ qs: Question[], answered?: Record<number, string[]> | null, disabled?: boolean }>()
const emit = defineEmits<{ answer: [text: string, picked: Record<number, string[]>] }>()

const sel = ref<Record<number, string[]>>({})
const other = ref<Record<number, string>>({})
const done = computed(() => !!props.answered)
const picked = (i: number, label: string) => (props.answered ?? sel.value)[i]?.includes(label)
const ready = computed(() => props.qs.every((_, i) => sel.value[i]?.length || other.value[i]?.trim()))
// one single-choice question: a tap is the answer, no extra Send step
const instant = computed(() => props.qs.length === 1 && !props.qs[0]!.multi)
// several questions: one tab each plus a Submit tab (index qs.length), like Claude Code's question dialog
const tabs = computed(() => props.qs.length > 1)
const cur = ref(props.answered && props.qs.length > 1 ? props.qs.length : 0)
const has = (i: number) => !!((props.answered ?? sel.value)[i]?.length || other.value[i]?.trim())
const answerOf = (i: number) => props.answered?.[i] ?? [...(sel.value[i] ?? []), ...(other.value[i]?.trim() ? [other.value[i]!.trim()] : [])]
/** after an answer, go to the next question still open, else to Submit */
function advance() {
  if (!tabs.value) return
  const n = props.qs.length
  for (let k = 1; k <= n; k++) {
    const j = (cur.value + k) % n
    if (!has(j)) return void (cur.value = j)
  }
  cur.value = n
}

function toggle(i: number, label: string) {
  if (done.value || props.disabled) return
  const q = props.qs[i]!
  const cur = sel.value[i] ?? []
  sel.value[i] = q.multi ? (cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label]) : [label]
  if (!q.multi) other.value[i] = ''
  if (instant.value) submit()
  else if (!q.multi) advance()
}
function submit() {
  if (!ready.value || done.value) return
  const out: Record<number, string[]> = {}
  const lines = props.qs.map((q, i) => {
    const o = other.value[i]?.trim()
    out[i] = [...(sel.value[i] ?? []), ...(o ? [o] : [])]
    return `- ${q.header || q.q}: ${out[i]!.join(', ')}`
  })
  emit('answer', props.qs.length === 1 ? out[0]!.join(', ') : `My answers:\n${lines.join('\n')}`, out)
}
</script>

<template>
  <div class="qs" :class="{ done, off: disabled && !done }">
    <div v-if="tabs" class="tabs" role="tablist">
      <button
        v-for="(q, i) in qs" :key="i" type="button" role="tab" class="tab" :class="{ on: cur === i, ok: has(i) }"
        :aria-selected="cur === i" @click="cur = i"
      >
        <span class="mark"><Icon :name="has(i) ? 'circle-check' : 'minus'" :size="14"/></span>{{ q.header || `Question ${i + 1}` }}
      </button>
      <button type="button" role="tab" class="tab" :class="{ on: cur === qs.length, ok: ready || done }" :aria-selected="cur === qs.length" @click="cur = qs.length">
        {{ done ? 'Answers' : 'Submit' }}
      </button>
    </div>
    <template v-for="(q, i) in qs" :key="i">
    <div v-if="!tabs || cur === i" class="q">
      <div class="title"><span v-if="q.header && !tabs" class="pill accent">{{ q.header }}</span> {{ q.q }}<span v-if="q.multi" class="faint small"> · pick any</span></div>
      <div class="opts">
        <button
          v-for="o in q.options" :key="o.label" type="button" class="opt" :class="{ on: picked(i, o.label), multi: q.multi }"
          :disabled="done || disabled" @click="toggle(i, o.label)"
        >
          <span v-if="q.multi" class="box" aria-hidden="true" />
          <span class="txt">
            <b>{{ o.label }}</b>
            <span v-if="o.description" class="muted small">{{ o.description }}</span>
          </span>
        </button>
        <input
          v-if="!done" v-model="other[i]" class="other" :placeholder="q.multi ? 'Other / add…' : 'Other…'" :disabled="disabled"
          enterkeyhint="send" @input="!q.multi && other[i] && (sel[i] = [])" @keydown.enter.prevent="tabs ? advance() : submit()"
        >
        <div v-else-if="answered?.[i]?.some(a => !q.options.some(o => o.label === a))" class="opt on">
          <b>{{ answered[i]!.filter(a => !q.options.some(o => o.label === a)).join(', ') }}</b>
        </div>
      </div>
      <div v-if="tabs && !done" class="nav">
        <button v-if="i > 0" type="button" class="btn ghost" @click="cur = i - 1"><Icon name="chevron-left" :size="16"/> Back</button>
        <button type="button" class="btn" :class="{ primary: has(i) }" @click="has(i) ? advance() : (cur = i + 1)">
          {{ has(i) ? 'Next' : 'Skip for now' }}<Icon name="chevron-right" :size="16"/>
        </button>
      </div>
    </div>
    </template>
    <div v-if="tabs && cur === qs.length" class="review">
      <button v-for="(q, i) in qs" :key="i" type="button" class="line" :disabled="done" @click="cur = i">
        <span class="muted">{{ q.header || q.q }}</span>
        <b v-if="answerOf(i).length">{{ answerOf(i).join(', ') }}</b>
        <span v-else class="warn">not answered yet</span>
      </button>
      <button v-if="!done" class="btn primary send" :disabled="!ready || disabled" @click="submit">Send answers</button>
    </div>
    <button v-if="!tabs && !done && !instant" class="btn primary send" :disabled="!ready || disabled" @click="submit">Send answers</button>
    <div v-if="disabled && !done" class="faint small">answered in chat instead</div>
  </div>
</template>

<style scoped>
.qs { display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: var(--radius); padding: 12px; background: var(--panel-2); }
.qs.off { opacity: .55; }
.q { display: flex; flex-direction: column; gap: 8px; }
.title { font-weight: 600; line-height: 1.4; }
.title .pill { margin-right: 4px; font-weight: 500; }
.opts { display: flex; flex-direction: column; gap: 6px; }
.opt { display: flex; align-items: center; gap: 10px; text-align: left; font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; cursor: pointer; }
.opt:hover:not(:disabled) { border-color: var(--faint); }
.opt.on { border-color: var(--accent); background: var(--accent-soft); }
.opt .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.opt .box { flex-shrink: 0; position: relative; width: 18px; height: 18px; border: 1.5px solid var(--line-2); border-radius: 5px; background: var(--bg); transition: background .12s, border-color .12s; }
.opt:hover:not(:disabled) .box { border-color: var(--faint); }
.opt.on .box { background: var(--accent); border-color: var(--accent); }
.opt .box::after { content: ''; position: absolute; left: 5px; top: 1.5px; width: 5px; height: 10px; border: solid var(--bg); border-width: 0 2px 2px 0; transform: rotate(45deg) scale(0); transition: transform .12s; }
.opt.on .box::after { transform: rotate(45deg) scale(1); }
.opt:disabled { cursor: default; }
.done .opt:not(.on) { opacity: .45; }
.other { font: inherit; padding: 8px 12px; border-radius: 8px; }
.send { align-self: flex-start; }
.tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; margin: -2px 0 -4px; padding-bottom: 2px; }
.tab { flex-shrink: 0; display: flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; color: var(--muted); background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm); padding: 4px 10px; cursor: pointer; white-space: nowrap; }
.tab:hover { color: var(--text); }
.tab.on { color: var(--text); background: var(--panel); border-color: var(--line-2); }
.tab .mark { color: var(--faint); }
.tab.ok .mark { color: var(--ok); }
.nav { display: flex; gap: 8px; justify-content: flex-end; }
.nav .btn { font-size: 13px; padding: 5px 12px; }
.review { display: flex; flex-direction: column; gap: 6px; }
.review .line { display: flex; flex-direction: column; gap: 2px; text-align: left; font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; cursor: pointer; }
.review .line:disabled { cursor: default; }
.review .line:hover:not(:disabled) { border-color: var(--faint); }
@media (max-width: 640px) { .other { font-size: 16px; } }
</style>
