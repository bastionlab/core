<script setup lang="ts">
/** net worth over time: every account + the depot, with time spans and per-account values on hover */
const h = ref<any>(null)
const err = ref('')
onMounted(async () => {
  try { h.value = await $fetch('/api/money/networth') } catch (e: any) { err.value = e?.data?.statusMessage || e?.message }
})
const RANGES = [['3M', 92], ['6M', 183], ['1J', 366], ['Max', -1]] as const
const span = ref('Max')
const all = computed<[string, number, number][]>(() => {
  if (!h.value) return []
  const accs = Object.values(h.value.accounts) as number[][]
  return h.value.days.map((d: string, i: number) => {
    const cash = accs.reduce((a, v) => a + (v[i] ?? 0), 0)
    return [d, Math.round(cash + (h.value.depot[i] ?? 0)), Math.round(cash)]
  })
})
const series = computed(() => {
  const r = RANGES.find(x => x[0] === span.value)!
  if (r[1] === -1) return all.value
  const d = new Date(); d.setDate(d.getDate() - r[1])
  return all.value.filter(p => p[0] >= isoDay(d))
})
const change = computed(() => (series.value.length > 1 ? series.value.at(-1)![1] - series.value[0]![1] : null))
</script>

<template>
  <Panel title="Net worth" :sub="series.length ? fmtEur(series.at(-1)![1], 0) : ''" id="money-worth">
    <div class="head">
      <span v-if="change != null" class="num" :class="change >= 0 ? 'ok' : 'bad'">{{ fmtSigned(change) }} since {{ dayTitle(series[0]![0]) }}</span>
      <div class="seg">
        <button v-for="r in RANGES" :key="r[0]" :class="{ on: span === r[0] }" @click="span = r[0]">{{ r[0] === '1J' ? '1Y' : r[0] }}</button>
      </div>
    </div>
    <div v-if="err" class="bad small">{{ err }}</div>
    <div v-else-if="!h" class="faint small pad">Reconstructing balances…</div>
    <MoneyLine v-else :series="series" mode="worth" />
  </Panel>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.pad { padding: 30px 0; text-align: center; }
</style>
