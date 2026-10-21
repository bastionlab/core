<script setup lang="ts">
/** the month as a calendar: what went out each day (darker = more), money in, and the subscriptions still due */
const props = defineProps<{ month: string, txs: any[], subs: any[], selected: string }>()
const emit = defineEmits<{ pick: [string] }>()
const SKIP = new Set(['Umbuchung', 'Investments'])

const days = computed(() => {
  const [y, m] = props.month.split('-').map(Number) as [number, number]
  const first = new Date(y, m - 1, 1, 12)
  const n = new Date(y, m, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const out: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= n; d++) out.push(`${props.month}-${String(d).padStart(2, '0')}`)
  while (out.length % 7) out.push(null)
  return out
})
const per = computed(() => {
  const m: Record<string, { out: number, in: number }> = {}
  for (const t of props.txs) {
    if (SKIP.has(t.category)) continue
    const x = (m[t.date] ??= { out: 0, in: 0 })
    if (t.amount < 0) x.out -= t.amount
    else x.in += t.amount
  }
  return m
})
const due = computed(() => {
  const today = isoDay()
  const end = `${props.month}-31`
  const m: Record<string, any[]> = {}
  for (const s of props.subs) for (const d of subCharges(s, end)) if (d >= today && d.startsWith(props.month)) (m[d] ??= []).push(s)
  return m
})
const max = computed(() => Math.max(1, ...Object.values(per.value).map(v => v.out)))
const today = isoDay()
const short = (n: number) => n >= 1000 ? `${(n / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : Math.round(n).toString()
const tip = (d: string) => {
  const p = per.value[d], s = due.value[d]
  return [dayTitle(d), p?.out ? `−${fmtEur(p.out)}` : '', p?.in ? `+${fmtEur(p.in)}` : '', ...(s ?? []).map(x => `fällig: ${subName(x)} ${fmtEur(x.amount)}`)].filter(Boolean).join('\n')
}
</script>

<template>
  <div class="cal">
    <span v-for="w in ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']" :key="w" class="wd">{{ w }}</span>
    <template v-for="(d, i) in days" :key="i">
      <span v-if="!d" class="cell empty" />
      <button v-else class="cell" :title="tip(d)"
              :class="{ today: d === today, on: d === selected, future: d > today }"
              :style="per[d]?.out ? { '--a': (0.1 + 0.55 * per[d].out / max).toFixed(2) } : {}"
              @click="emit('pick', d === selected ? '' : d)">
        <span class="dn">{{ +d.slice(8) }}</span>
        <span v-if="per[d]?.out" class="amt">{{ short(per[d].out) }}</span>
        <span class="marks">
          <i v-if="per[d]?.in" class="in" />
          <i v-for="s in due[d] ?? []" :key="s.key" class="due" />
        </span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.wd { text-align: center; font-size: 11px; color: var(--faint); padding-bottom: 2px; }
.cell { position: relative; aspect-ratio: 1 / .82; min-height: 40px; border: 1px solid transparent; border-radius: 8px; padding: 3px 4px; font: inherit; color: var(--text); cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between;
  background: color-mix(in srgb, var(--accent) calc(var(--a, 0) * 100%), var(--panel-2)); }
.cell.empty { background: none; cursor: default; }
.cell.future { opacity: .75; background: transparent; border-color: var(--line); }
.cell.today { border-color: var(--accent); }
.cell.on { outline: 2px solid var(--text); outline-offset: -2px; }
.dn { font-size: 11px; color: var(--muted); line-height: 1; }
.today .dn { color: var(--accent); font-weight: 700; }
.amt { font-size: 12px; font-weight: 600; line-height: 1; align-self: flex-end; }
.marks { position: absolute; top: 4px; right: 4px; display: flex; gap: 2px; }
.marks i { width: 5px; height: 5px; border-radius: 50%; }
.marks .in { background: var(--ok); }
.marks .due { background: var(--warn); }
@media (max-width: 560px) { .amt { font-size: 10.5px; } .cell { min-height: 36px; padding: 2px 3px; } }
</style>
