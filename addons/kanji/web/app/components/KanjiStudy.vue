<script setup lang="ts">
/**
 * The review screen. Reading cards: kanji → Show answer → Again / Hard / Good / Easy (new ones get a guided trace).
 * Write cards: meaning (or a whole word) → write it on the pad from memory → the misses suggest the rating.
 * Keys: space = show / the suggested rating, 1–4, z = undo
 */
const props = defineProps<{ start: any }>()
const emit = defineEmits<{ close: [], changed: [] }>()

const q = ref<any>(props.start)
const shown = ref(false)
const busy = ref(false)
const error = ref('')
const strokes = ref(false)
const tracing = ref(false)
const reviewed = ref(0)
const result = ref<{ mistakes: number, hints: number, gaveUp?: boolean } | null>(null)
const pad = ref<any>()
let t0 = Date.now()
const LABELS = ['Again', 'Hard', 'Good', 'Easy']

const card = computed(() => q.value?.card)
const writing = computed(() => card.value?.kind === 'write')
const word = computed<[string, string, string] | null>(() => (writing.value ? card.value.word : null))

function take(r: any) {
  q.value = r; shown.value = false; strokes.value = false; result.value = null; t0 = Date.now(); error.value = ''
  tracing.value = false
}
async function post(body: Record<string, any>) {
  if (busy.value) return
  busy.value = true
  try { take(await $fetch<any>('/api/kanji/action', { method: 'POST', body })); emit('changed'); return true }
  catch (e: any) { error.value = e?.data?.statusMessage || e?.message }
  finally { busy.value = false }
}
async function rate(r: number) {
  if (!shown.value || !card.value) return
  if (await post({ action: 'answer', k: card.value.id, rating: r, secs: Math.min(60, (Date.now() - t0) / 1000) })) reviewed.value++
}
async function undo() { if (await post({ action: 'undo' })) reviewed.value = Math.max(0, reviewed.value - 1) }

// --- writing ---
function written(r: { mistakes: number, hints: number }) { result.value = r; setTimeout(() => (shown.value = true), 300) }
function giveUp() { pad.value?.reveal(); result.value = { mistakes: 0, hints: 0, gaveUp: true }; shown.value = true }
/** misses per kanji → rating: clean = Good, a slip or two = Hard, more (or a shown stroke too many) = Again */
const suggested = computed(() => {
  const r = result.value
  if (!writing.value) return 3
  if (!r || r.gaveUp) return 1
  const n = word.value ? [...word.value[0]].filter(c => /[一-鿿]/.test(c)).length : 1
  const bad = (r.mistakes + 2 * r.hints) / n
  return bad === 0 ? 3 : bad <= 2 ? 2 : 1
})

// which counter the card on screen comes out of (underlined, like Anki)
const from = computed(() => { const s = card.value?.state; return s === 'new' ? 'new' : s === 'review' ? 'review' : s ? 'learn' : '' })

// waiting for a learning step: count down, then ask again
const left = ref(0)
let tick: any
watch(() => q.value?.wait, (w) => {
  clearInterval(tick)
  left.value = w || 0
  if (!w || q.value?.card) return
  tick = setInterval(async () => {
    if (--left.value > 0) return
    clearInterval(tick)
    take(await $fetch<any>('/api/kanji').then(r => r.next).catch(() => q.value))
  }, 1000)
}, { immediate: true })
onUnmounted(() => clearInterval(tick))
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'Escape') emit('close')
  else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    if (shown.value) rate(suggested.value)
    else if (!writing.value) shown.value = true
  }
  else if (/^[1-4]$/.test(e.key)) rate(Number(e.key))
  else if (e.key === 'z') undo()
  else if (e.key === 'h' && writing.value && !shown.value) pad.value?.hint()
}
onMounted(() => { window.addEventListener('keydown', onKey); document.documentElement.style.overflow = 'hidden' })
onUnmounted(() => { window.removeEventListener('keydown', onKey); document.documentElement.style.overflow = '' })
</script>

<template>
  <div class="study">
    <header>
      <button type="button" class="btn ghost icon" aria-label="close" @click="emit('close')">✕</button>
      <div class="counts">
        <span class="c-new" :class="{ on: from === 'new' }">{{ q.new }}</span>
        <span class="c-learn" :class="{ on: from === 'learn' }">{{ q.learn }}</span>
        <span class="c-rev" :class="{ on: from === 'review' }">{{ q.review }}</span>
      </div>
      <button type="button" class="btn ghost sm" :disabled="busy || !reviewed" @click="undo">Undo</button>
    </header>

    <p v-if="error" class="errbox">{{ error }}</p>

    <!-- write card: prompt + pad, then the answer -->
    <main v-if="card && writing" :key="card.id + card.reps">
      <div class="meta">
        <span class="pill">N{{ card.n }}</span>
        <span class="pill accent">✍️ {{ word ? 'write the word' : 'write' }}</span>
        <span v-if="card.state === 'new'" class="pill accent">new</span>
      </div>
      <div v-if="word" class="prompt">
        <div class="mean">{{ word[2] }}</div>
        <div lang="ja" class="jp muted">{{ word[1] }}</div>
      </div>
      <div v-else class="prompt">
        <div class="mean">{{ card.m.join(', ') }}</div>
        <div lang="ja" class="jp muted">{{ [...card.kun.map((r: string) => r.replace(/[.-]/g, '')), ...card.on.map(kata)].slice(0, 4).join('、') }}</div>
      </div>
      <KanjiWrite v-if="word" ref="pad" :form="word[0]" @done="written" />
      <KanjiTrace v-else ref="pad" :k="card.k" @done="written" />
      <template v-if="shown">
        <div class="verdict" :class="['bad', 'warn', 'ok'][suggested - 1]">
          {{ result?.gaveUp ? 'Shown' : result && !result.mistakes && !result.hints ? 'Perfect' : `${result?.mistakes ?? 0} miss${result?.mistakes === 1 ? '' : 'es'}${result?.hints ? ` · ${result.hints} shown` : ''}` }}
        </div>
        <div lang="ja" class="kanji sm">{{ card.k }}</div>
        <KanjiFace :c="card" />
      </template>
    </main>

    <!-- reading card -->
    <main v-else-if="card" :key="card.id + card.reps" @click="shown = true">
      <div class="meta"><span class="pill">N{{ card.n }}</span><span v-if="card.state === 'new'" class="pill accent">new</span><span v-if="card.lapses >= 4" class="pill warn">leech</span></div>
      <div lang="ja" class="kanji">{{ card.k }}</div>
      <template v-if="shown">
        <KanjiFace :c="card" />
        <div class="more" @click.stop>
          <KanjiTrace v-if="tracing || card.state === 'new'" :k="card.k" guide />
          <div class="links">
            <button v-if="!tracing && card.state !== 'new'" type="button" class="lnk small" @click="tracing = true">✍️ Trace it</button>
            <button v-if="!strokes" type="button" class="lnk small" @click="strokes = true">Stroke order · {{ card.s }}</button>
          </div>
          <KanjiStrokes v-if="strokes" :k="card.k" />
        </div>
      </template>
    </main>

    <main v-else class="done">
      <template v-if="q.wait">
        <div class="big">⏳</div>
        <b>Next learning card in {{ mmss(left) }}</b>
      </template>
      <template v-else>
        <div class="big">🎉</div>
        <b>Done for today</b>
        <span class="muted small">{{ reviewed }} reviewed this session</span>
      </template>
      <button type="button" class="btn" @click="emit('close')">Close</button>
    </main>

    <footer v-if="card">
      <div v-if="!shown && writing" class="two">
        <button type="button" class="btn" @click="pad?.hint()">Show stroke</button>
        <button type="button" class="btn" @click="giveUp">I don't know</button>
      </div>
      <button v-else-if="!shown" type="button" class="btn primary show" @click="shown = true">Show answer</button>
      <div v-else class="rate">
        <button v-for="(l, i) in LABELS" :key="l" type="button" class="btn" :class="[`r${i + 1}`, { sugg: writing && suggested === i + 1 }]" :disabled="busy" @click="rate(i + 1)">
          <span class="ivl">{{ q.buttons?.[i] }}</span>{{ l }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.study { position: fixed; inset: 0; z-index: 60; background: var(--bg); display: flex; flex-direction: column; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); }
header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); max-width: 760px; width: 100%; margin: 0 auto; }
.counts { flex: 1; display: flex; justify-content: center; gap: 16px; font-weight: 650; font-size: 16px; }
.counts span { padding: 0 2px 1px; border-bottom: 2px solid transparent; }
.counts .on { border-bottom-color: currentColor; }
.c-new { color: var(--accent); } .c-learn { color: var(--bad); } .c-rev { color: var(--ok); }
.errbox { margin: 10px auto 0; max-width: 720px; }
main { flex: 1; overflow-y: auto; padding: 18px 16px 24px; display: flex; flex-direction: column; gap: 14px; max-width: 640px; width: 100%; margin: 0 auto; }
.meta { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.kanji { font-size: 128px; line-height: 1.1; text-align: center; font-weight: 400; font-family: 'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif; user-select: none; }
.kanji.sm { font-size: 64px; }
.prompt { text-align: center; display: flex; flex-direction: column; gap: 2px; }
.prompt .mean { font-size: 20px; font-weight: 600; }
.prompt .jp { font-size: 16px; }
.verdict { text-align: center; font-weight: 600; }
.more { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.links { display: flex; gap: 18px; }
.done { align-items: center; justify-content: center; text-align: center; gap: 8px; }
.big { font-size: 48px; }
footer { border-top: 1px solid var(--line); padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); max-width: 760px; width: 100%; margin: 0 auto; }
.show { width: 100%; min-height: 48px; font-size: 15px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.two .btn { min-height: 48px; }
.rate { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.rate .btn { flex-direction: column; gap: 0; min-height: 52px; font-size: 13.5px; font-weight: 600; }
.rate .sugg { border-color: currentColor; box-shadow: 0 0 0 1px currentColor inset; }
.ivl { font-size: 11px; font-weight: 400; color: var(--muted); }
.r1 { color: var(--bad); } .r2 { color: var(--warn); } .r3 { color: var(--ok); } .r4 { color: var(--accent); }
@media (max-width: 640px) { .kanji { font-size: 112px; } main { padding: 12px 12px 18px; gap: 10px; } }
</style>
