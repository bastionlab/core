<script setup lang="ts">
/** portfolio value over time (+ amount invested, same € axis), crosshair tooltip on hover/touch */
const props = defineProps<{ series: { day: string, value: number, invested: number }[] }>()
const W = 600, H = 150, P = { l: 4, r: 4, t: 8, b: 8 }
const pts = computed(() => props.series.filter(s => s.value != null))
const range = computed(() => {
  const vals = pts.value.flatMap(s => [s.value, s.invested ?? s.value])
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo) * 0.08 || hi * 0.02 || 1
  return { lo: lo - pad, hi: hi + pad }
})
const x = (i: number) => P.l + (pts.value.length < 2 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (pts.value.length - 1))
const y = (v: number) => P.t + (1 - (v - range.value.lo) / (range.value.hi - range.value.lo)) * (H - P.t - P.b)
const path = (k: 'value' | 'invested') => pts.value.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[k] ?? s.value).toFixed(1)}`).join('')
const hover = ref<number | null>(null)
function move(e: PointerEvent) {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect()
  const fx = ((e.clientX - r.left) / r.width) * W
  hover.value = Math.max(0, Math.min(pts.value.length - 1, Math.round(((fx - P.l) / (W - P.l - P.r)) * (pts.value.length - 1))))
}
const h = computed(() => (hover.value == null ? null : pts.value[hover.value]))
const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const dm = (d: string) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' })
</script>

<template>
  <div class="lc">
    <div class="legend small">
      <span><i class="sw v" />Depotwert</span><span><i class="sw inv" />investiert</span>
      <span v-if="h" class="tip">{{ dm(h.day) }} · <b>{{ eur(h.value) }}</b> · investiert {{ eur(h.invested) }}</span>
    </div>
    <svg v-if="pts.length > 1" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="chart"
         @pointermove="move" @pointerdown="move" @pointerleave="hover = null">
      <path :d="path('invested')" class="inv" />
      <path :d="path('value')" class="v" />
      <template v-if="h && hover != null">
        <line :x1="x(hover)" :x2="x(hover)" :y1="P.t" :y2="H - P.b" class="cross" />
        <circle :cx="x(hover)" :cy="y(h.value)" r="4" class="pt" />
      </template>
    </svg>
    <div v-if="pts.length > 1" class="ax small"><span>{{ dm(pts[0].day) }}</span><span>{{ dm(pts[pts.length - 1].day) }}</span></div>
    <div v-else class="faint small pad">Die Kurve wächst ab dem zweiten Tag (ein Snapshot pro Sync).</div>
  </div>
</template>

<style scoped>
.chart { width: 100%; height: 150px; display: block; touch-action: pan-y; }
.v { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
.inv { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.cross { stroke: var(--line-2); stroke-width: 1; vector-effect: non-scaling-stroke; }
.pt { fill: var(--accent); stroke: var(--panel); stroke-width: 2; vector-effect: non-scaling-stroke; }
.ax { display: flex; justify-content: space-between; color: var(--faint); margin-bottom: 8px; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); margin-bottom: 6px; min-height: 18px; }
.legend .tip { margin-left: auto; color: var(--text); }
.sw { display: inline-block; width: 14px; height: 2px; vertical-align: middle; margin-right: 5px; background: var(--accent); }
.sw.inv { background: none; border-top: 2px dashed var(--muted); height: 0; }
.pad { padding: 20px 0; }
</style>
