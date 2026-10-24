<script setup lang="ts">
/**
 * Draw a kanji with a finger, stroke by stroke. Each stroke is checked against the next KanjiVG stroke (shape,
 * position, direction, order); a right one snaps into place, a wrong one flashes red. Two misses on the same stroke
 * show it. guide = the whole kanji shows faintly underneath (learning), otherwise it is from memory.
 */
const props = defineProps<{ k: string, guide?: boolean }>()
const emit = defineEmits<{ done: [{ mistakes: number, hints: number }] }>()

const data = ref<{ paths: string[] } | null>(null)
const error = ref('')
const idx = ref(0)
const mistakes = ref(0)
const hints = ref(0)
const missHere = ref(0)
const hinting = ref(-1)
const drawing = ref<number[][]>([])
const wrong = ref<number[][] | null>(null)
const svg = ref<SVGSVGElement>()
const els: SVGPathElement[] = [] // v-for template refs don't keep order, so index them by hand
let expected: number[][][] = []

watch(() => props.k, async (k) => {
  data.value = null; error.value = ''; reset(); els.length = 0
  try { data.value = await $fetch(`/api/kanji/strokes`, { query: { k } }) } catch (e: any) { error.value = e?.data?.statusMessage || 'no stroke order' }
  await nextTick()
  expected = data.value ? data.value.paths.map((_, i) => sample(els[i]!)) : []
}, { immediate: true })

function reset() { idx.value = 0; mistakes.value = 0; hints.value = 0; missHere.value = 0; hinting.value = -1; drawing.value = []; wrong.value = null }
const total = computed(() => data.value?.paths.length ?? 0)
const done = computed(() => total.value > 0 && idx.value >= total.value)

// --- geometry (KanjiVG's 109 × 109 box) ---
const N = 24
function sample(p: SVGPathElement) {
  const len = p.getTotalLength()
  return Array.from({ length: N }, (_, i) => { const q = p.getPointAtLength((len * i) / (N - 1)); return [q.x, q.y] })
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)
const length = (pts: number[][]) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]!), 0)
function resample(pts: number[][]) {
  const L = length(pts)
  if (L === 0) return Array.from({ length: N }, () => pts[0]!)
  const out = [pts[0]!], step = L / (N - 1)
  let acc = 0
  for (let i = 1; i < pts.length && out.length < N; i++) {
    let a = pts[i - 1]!, d = dist(a, pts[i]!)
    while (acc + d >= step && out.length < N) {
      const t = (step - acc) / d
      a = [a[0]! + t * (pts[i]![0]! - a[0]!), a[1]! + t * (pts[i]![1]! - a[1]!)]
      out.push(a); d = dist(a, pts[i]!); acc = 0
    }
    acc += d
  }
  while (out.length < N) out.push(pts.at(-1)!)
  return out
}
const mean = (a: number[][], b: number[][]) => a.reduce((s, p, i) => s + dist(p, b[i]!), 0) / a.length

/**
 * how far a drawn stroke is from an expected one (Infinity = not it): close along its whole length, not much
 * shorter or longer, and drawn in the right direction (start nearer the start than the end)
 */
function score(drawn: number[][], exp: number[][]) {
  const d = resample(drawn), lenE = length(exp), lenD = length(drawn)
  const tol = Math.max(13, Math.min(20, lenE * 0.3))
  if (lenE > 20 && (lenD < lenE * 0.45 || lenD > lenE * 2.2)) return Infinity
  const s0 = dist(d[0]!, exp[0]!), s1 = dist(d.at(-1)!, exp.at(-1)!)
  if (s0 > tol * 1.5 || s1 > tol * 1.5) return Infinity
  if (lenE > 15 && (dist(d[0]!, exp.at(-1)!) < s0 || dist(d.at(-1)!, exp[0]!) < s1)) return Infinity
  const m = mean(d, exp)
  return m < tol ? m : Infinity
}
/** right = fits the next stroke, and none of the strokes still to come fits better (三's lines are close together) */
function matches(drawn: number[][], i: number) {
  const s = score(drawn, expected[i]!)
  return s < Infinity && expected.slice(i + 1).every(e => score(drawn, e) >= s)
}

// --- pointer ---
function point(e: PointerEvent) {
  const r = svg.value!.getBoundingClientRect()
  return [((e.clientX - r.left) / r.width) * 109, ((e.clientY - r.top) / r.height) * 109]
}
function down(e: PointerEvent) {
  if (done.value || !expected.length) return
  svg.value!.setPointerCapture(e.pointerId)
  drawing.value = [point(e)]
}
function move(e: PointerEvent) {
  if (!drawing.value.length) return
  for (const c of (e.getCoalescedEvents?.() ?? [e])) drawing.value.push(point(c))
}
function up() {
  const pts = drawing.value
  drawing.value = []
  if (!pts.length || length(pts) < 3) return // a tap, not a stroke
  if (matches(pts, idx.value)) {
    idx.value++; missHere.value = 0; hinting.value = -1
    if (done.value) emit('done', { mistakes: mistakes.value, hints: hints.value })
    return
  }
  mistakes.value++; missHere.value++
  wrong.value = pts
  setTimeout(() => { if (wrong.value === pts) wrong.value = null }, 450)
  if (missHere.value >= 2 && hinting.value !== idx.value) { hinting.value = idx.value; hints.value++ }
}
function hint() { if (!done.value && hinting.value !== idx.value) { hinting.value = idx.value; hints.value++ } }
/** give up: the rest of the kanji appears */
function reveal() { idx.value = total.value }
defineExpose({ hint, reset, reveal, mistakes, hints, done })

const line = (pts: number[][]) => pts.map(p => `${p[0]!.toFixed(1)},${p[1]!.toFixed(1)}`).join(' ')
const start = computed(() => (props.guide && !done.value ? expected[idx.value]?.[0] : null))
</script>

<template>
  <div class="trace">
    <svg ref="svg" viewBox="0 0 109 109" :class="{ done }" @pointerdown.prevent="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <path d="M54.5 0V109M0 54.5H109" class="grid" />
      <template v-if="data">
        <path v-for="(d, i) in data.paths" :key="`g${i}`" :ref="el => { if (el) els[i] = el as SVGPathElement }" :d="d" class="ghost" :class="{ on: guide, next: guide && i === idx }" />
        <path v-for="(d, i) in data.paths.slice(0, idx)" :key="`i${i}`" :d="d" class="ink" />
        <path v-if="hinting >= 0 && hinting === idx && !done" :key="`h${hinting}`" :d="data.paths[hinting]" pathLength="1" class="hint" />
      </template>
      <circle v-if="start" :cx="start[0]" :cy="start[1]" r="3" class="start" />
      <polyline v-if="wrong" :points="line(wrong)" class="wrong" />
      <polyline v-if="drawing.length" :points="line(drawing)" class="pen" />
    </svg>
    <div v-if="!data" class="ph faint small">{{ error || 'Loading…' }}</div>
    <div v-else class="info faint small">
      <span>{{ Math.min(idx, total) }}/{{ total }} strokes</span>
      <span v-if="mistakes" class="bad">{{ mistakes }} miss{{ mistakes > 1 ? 'es' : '' }}</span>
    </div>
  </div>
</template>

<style scoped>
.trace { display: flex; flex-direction: column; align-items: center; gap: 4px; position: relative; }
svg { width: min(78vw, 300px, 42vh); aspect-ratio: 1; background: var(--panel); border: 1px solid var(--line-2); border-radius: var(--radius); touch-action: none; user-select: none; -webkit-user-select: none; cursor: crosshair; }
svg.done { border-color: var(--ok); }
path, polyline { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.grid { stroke: var(--line); stroke-width: .6; stroke-dasharray: 2 2; }
.ghost { stroke: transparent; stroke-width: 3; }
.ghost.on { stroke: var(--line-2); }
.ghost.next { stroke: var(--faint); }
.ink { stroke: var(--text); stroke-width: 3.6; }
.done .ink { stroke: var(--ok); }
.pen { stroke: var(--accent); stroke-width: 3.6; }
.wrong { stroke: var(--bad); stroke-width: 3.6; animation: fade .45s forwards; }
.hint { stroke: var(--warn); stroke-width: 3.6; stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw .8s ease-out forwards; }
.start { fill: var(--accent); }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes fade { to { opacity: 0; } }
.ph { position: absolute; inset: 0; display: grid; place-items: center; }
.info { display: flex; gap: 10px; }
</style>
