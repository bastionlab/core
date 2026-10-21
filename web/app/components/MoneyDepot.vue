<script setup lang="ts">
/** Depot tab: total or one position, pick the time span, performance over that span, positions with allocation */
const props = defineProps<{ positions: any[], cash?: number | null }>()
const route = useRoute()
const router = useRouter()

const h = ref<any>(null)
const err = ref('')
onMounted(async () => {
  try { h.value = await $fetch('/api/money/depot') } catch (e: any) { err.value = e?.data?.statusMessage || e?.message }
})

const RANGES = [['1M', 31], ['3M', 92], ['6M', 183], ['YTD', 0], ['1J', 366], ['Max', -1]] as const
const span = computed({ get: () => String(route.query.r || '1J'), set: v => router.replace({ query: { ...route.query, r: v } }) })
const pick = computed({ get: () => String(route.query.p || ''), set: v => router.replace({ query: { ...route.query, p: v || undefined } }) })

const full = computed<[string, number, number][]>(() => !h.value ? [] : pick.value ? (h.value.positions[pick.value]?.series ?? []) : h.value.total)
const from = computed(() => {
  const r = RANGES.find(x => x[0] === span.value) ?? RANGES[4]
  if (r[1] === -1) return ''
  const d = new Date()
  if (r[1] === 0) return `${d.getFullYear()}-01-01`
  d.setDate(d.getDate() - r[1])
  return isoDay(d)
})
const series = computed(() => {
  const s = full.value
  if (!from.value) return s
  // keep the last point before the window as its start, so the line begins at the window's edge value
  const i = s.findIndex(p => p[0] >= from.value)
  return i < 0 ? s.slice(-1) : s.slice(Math.max(0, i - 1))
})
// performance in the span = value change minus what you paid in during it (a Sparplan isn't a gain)
const perf = computed(() => {
  const s = series.value
  if (s.length < 2) return null
  const a = s[0]!, b = s.at(-1)!
  const gain = (b[1] - a[1]) - (b[2] - a[2])
  const base = a[1] + Math.max(0, b[2] - a[2]) / 2
  return { gain, pct: base > 0 ? (100 * gain) / base : 0, paid: b[2] - a[2] }
})
const now = computed(() => series.value.at(-1))
const sel = computed(() => (pick.value ? props.positions.find(p => p.isin === pick.value) : null))
const total = computed(() => props.positions.reduce((a, p) => a + p.value, 0))
const totalIn = computed(() => props.positions.reduce((a, p) => a + (p.buyin || 0), 0))
const trades = computed(() => (pick.value ? h.value?.positions[pick.value]?.trades ?? [] : []).slice().reverse().slice(0, 12))
const label = (p: any) => p.label || p.name
</script>

<template>
  <div class="depot">
    <div class="chips">
      <button class="chip" :class="{ on: !pick }" @click="pick = ''">Gesamt</button>
      <button v-for="p in positions" :key="p.isin" class="chip" :class="{ on: pick === p.isin }" @click="pick = p.isin">{{ label(p) }}</button>
    </div>

    <Panel :title="sel ? label(sel) : 'Depot'" :sub="sel ? sel.isin : ''" id="money-depot-chart">
      <div class="head">
        <span class="big num">{{ fmtEur(now?.[1] ?? (sel ? sel.value : total), 0) }}</span>
        <span v-if="perf" class="num" :class="perf.gain >= 0 ? 'ok' : 'bad'">{{ fmtSigned(perf.gain) }} · {{ fmtPct(perf.pct) }}</span>
        <span v-if="perf && perf.paid > 0.5" class="faint small">+ {{ fmtEur(perf.paid, 0) }} eingezahlt</span>
      </div>
      <div class="ranges">
        <button v-for="r in RANGES" :key="r[0]" class="rg" :class="{ on: span === r[0] }" @click="span = r[0]">{{ r[0] }}</button>
      </div>
      <div v-if="err" class="bad small">{{ err }}</div>
      <div v-else-if="!h" class="faint small pad">Lade Kursverlauf…</div>
      <MoneyLine v-else :series="series" />
    </Panel>

    <Panel title="Positionen" :sub="`${fmtEur(total, 0)} · ${fmtSigned(total - totalIn)} gesamt`" id="money-positions" class="gap">
      <div v-if="!positions.length" class="faint small">Trade Republic verbinden, dann kommen hier deine Positionen.</div>
      <button v-for="p in positions" :key="p.isin" class="pos" :class="{ on: pick === p.isin }" @click="pick = pick === p.isin ? '' : p.isin">
        <span class="pn">
          <span class="nm">{{ label(p) }}</span>
          <span class="faint small">{{ p.shares.toLocaleString('de-DE', { maximumFractionDigits: 3 }) }} St. · Ø {{ fmtEur(p.buyin / p.shares) }} → {{ fmtEur(p.value / p.shares) }}</span>
          <span class="alloc"><i :style="{ width: (100 * (p.share ?? 0)) + '%' }" /></span>
        </span>
        <span class="pv">
          <span class="num">{{ fmtEur(p.value, 0) }}</span>
          <span class="num small" :class="p.value - p.buyin >= 0 ? 'ok' : 'bad'">{{ fmtSigned(p.value - p.buyin) }} · {{ p.buyin ? fmtPct((100 * (p.value - p.buyin)) / p.buyin) : '' }}</span>
          <span class="faint small">{{ Math.round(100 * (p.share ?? 0)) }} %</span>
        </span>
      </button>
      <div v-if="cash != null" class="cash small"><span class="muted">Verrechnungskonto (nicht im Depotwert)</span><span class="num">{{ fmtEur(cash, 0) }}</span></div>
    </Panel>

    <Panel v-if="trades.length" title="Käufe & Verkäufe" :sub="sel ? label(sel) : ''" id="money-trades" class="gap" fold="phone">
      <div v-for="(t, i) in trades" :key="i" class="tr small">
        <span class="faint">{{ dayTitle(t.day) }}</span>
        <span>{{ t.shares > 0 ? 'Kauf' : 'Verkauf' }} {{ Math.abs(t.shares).toLocaleString('de-DE', { maximumFractionDigits: 4 }) }} St.</span>
        <span class="num">{{ fmtEur(Math.abs(t.amount)) }}</span>
      </div>
    </Panel>
  </div>
</template>

<style scoped>
.chips { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 12px; scrollbar-width: none; }
.chip { flex: none; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.chip.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.head { display: flex; align-items: baseline; gap: 6px 12px; flex-wrap: wrap; margin-bottom: 8px; }
.big { font-size: 24px; font-weight: 600; }
.ranges { display: flex; gap: 2px; margin-bottom: 10px; background: var(--panel-2); border-radius: 8px; padding: 2px; width: fit-content; max-width: 100%; }
.rg { border: 0; background: none; color: var(--muted); font: inherit; font-size: 12.5px; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.rg.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.pad { padding: 30px 0; text-align: center; }
.gap { margin-top: 16px; }
.pos { display: flex; gap: 12px; width: 100%; padding: 10px 6px; border: 0; border-top: 1px solid var(--line); background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; border-radius: 6px; }
.pos:first-of-type { border-top: 0; }
.pos:hover, .pos.on { background: var(--accent-soft); }
.pn { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.alloc { height: 4px; background: var(--track); border-radius: 2px; overflow: hidden; margin-top: 2px; }
.alloc i { display: block; height: 100%; background: var(--accent); }
.pv { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.cash { display: flex; justify-content: space-between; padding: 10px 6px 0; border-top: 1px solid var(--line); }
.tr { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; padding: 5px 0; border-top: 1px solid var(--line); }
.tr:first-of-type { border-top: 0; }
</style>
