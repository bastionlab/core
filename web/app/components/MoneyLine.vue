<script setup lang="ts">
/** value over time (+ cost basis dashed, same € axis) on a real time axis, so weekly and daily points
 * don't stretch the picture; € ticks on the right, crosshair tooltip on hover/touch */
const props = defineProps<{ series: [string, number, number][], height?: number }>()
const W = 600
const H = computed(() => props.height ?? 180)
const P = { l: 2, r: 2, t: 10, b: 6 }
const pts = computed(() => props.series.map(([d, v, inv]) => ({ day: d, t: new Date(d + 'T12:00').getTime(), value: v, invested: inv })))
const tr = computed(() => {
  const p = pts.value
  return { a: p[0]?.t ?? 0, b: Math.max((p.at(-1)?.t ?? 1), (p[0]?.t ?? 0) + 1) }
})
const nice = (v: number, up: boolean) => {
  const step = 10 ** Math.floor(Math.log10(Math.max(Math.abs(v), 1))) / 2
  return (up ? Math.ceil(v / step) : Math.floor(v / step)) * step
}
const range = computed(() => {
  const vals = pts.value.flatMap(s => [s.value, s.invested])
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo) * 0.06 || hi * 0.02 || 1
  return { lo: Math.max(0, nice(lo - pad, false)), hi: nice(hi + pad, true) }
})
const x = (t: number) => P.l + ((t - tr.value.a) / (tr.value.b - tr.value.a)) * (W - P.l - P.r)
const y = (v: number) => P.t + (1 - (v - range.value.lo) / (range.value.hi - range.value.lo || 1)) * (H.value - P.t - P.b)
const line = (k: 'value' | 'invested') => pts.value.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s[k]).toFixed(1)}`).join('')
const area = computed(() => pts.value.length < 2 ? '' : `${line('value')}L${x(pts.value.at(-1)!.t).toFixed(1)},${H.value - P.b}L${x(pts.value[0]!.t).toFixed(1)},${H.value - P.b}Z`)
const ticks = computed(() => [0, 0.5, 1].map(f => range.value.lo + f * (range.value.hi - range.value.lo)))
const up = computed(() => (pts.value.at(-1)?.value ?? 0) >= (pts.value.at(-1)?.invested ?? 0))

const hover = ref<number | null>(null)
function move(e: PointerEvent) {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect()
  const t = tr.value.a + (((e.clientX - r.left) / r.width) * W - P.l) / (W - P.l - P.r) * (tr.value.b - tr.value.a)
  let best = 0
  pts.value.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(pts.value[best]!.t - t)) best = i })
  hover.value = best
}
const h = computed(() => (hover.value == null ? null : pts.value[hover.value]))
const short = (n: number) => n >= 10000 ? `${(n / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : Math.round(n).toLocaleString('de-DE')
const dm = (d: string) => new Date(d + 'T12:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' })
</script>

<template>
  <div class="lc">
    <div class="legend small">
      <template v-if="!h"><span><i class="sw v" :class="{ down: !up }" />Wert</span><span><i class="sw inv" />eingezahlt</span></template>
      <span v-else class="tip">{{ dm(h.day) }} · <b>{{ fmtEur(h.value, 0) }}</b> · eingezahlt {{ fmtEur(h.invested, 0) }} ·
        <b :class="h.value - h.invested >= 0 ? 'ok' : 'bad'">{{ fmtSigned(h.value - h.invested) }}</b></span>
    </div>
    <div v-if="pts.length > 1" class="box">
      <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="chart" :style="{ height: H + 'px' }"
           @pointermove="move" @pointerdown="move" @pointerleave="hover = null">
        <line v-for="t in ticks" :key="t" :x1="0" :x2="W" :y1="y(t)" :y2="y(t)" class="grid" />
        <path :d="area" class="area" :class="{ down: !up }" />
        <path :d="line('invested')" class="inv" />
        <path :d="line('value')" class="v" :class="{ down: !up }" />
        <template v-if="h">
          <line :x1="x(h.t)" :x2="x(h.t)" :y1="P.t" :y2="H - P.b" class="cross" />
          <circle :cx="x(h.t)" :cy="y(h.value)" r="4" class="pt" :class="{ down: !up }" />
        </template>
      </svg>
      <span v-for="t in ticks" :key="'l' + t" class="yl" :style="{ top: y(t) + 'px' }">{{ short(t) }}</span>
    </div>
    <div v-if="pts.length > 1" class="ax small"><span>{{ dm(pts[0]!.day) }}</span><span>{{ dm(pts[Math.floor(pts.length / 2)]!.day) }}</span><span>{{ dm(pts.at(-1)!.day) }}</span></div>
    <div v-else class="faint small pad">Noch keine Kursdaten – kommen mit dem nächsten Trade-Republic-Sync.</div>
  </div>
</template>

<style scoped>
.box { position: relative; }
.chart { width: 100%; display: block; touch-action: pan-y; }
.grid { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
.v { fill: none; stroke: var(--ok); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.area { fill: var(--ok-soft); stroke: none; }
.v.down { stroke: var(--bad); } .area.down { fill: var(--bad-soft); }
.inv { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.cross { stroke: var(--line-2); stroke-width: 1; vector-effect: non-scaling-stroke; }
.pt { fill: var(--ok); stroke: var(--panel); stroke-width: 2; vector-effect: non-scaling-stroke; }
.pt.down { fill: var(--bad); }
.yl { position: absolute; right: 2px; transform: translateY(-100%); font-size: 10.5px; color: var(--faint); pointer-events: none; background: color-mix(in srgb, var(--panel) 70%, transparent); padding: 0 3px; border-radius: 3px; }
.ax { display: flex; justify-content: space-between; color: var(--faint); margin-top: 4px; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); margin-bottom: 6px; min-height: 18px; }
.legend .tip { color: var(--text); }
.sw { display: inline-block; width: 14px; height: 2px; vertical-align: middle; margin-right: 5px; background: var(--ok); }
.sw.down { background: var(--bad); }
.sw.inv { background: none; border-top: 2px dashed var(--muted); height: 0; }
.pad { padding: 20px 0; }
</style>
