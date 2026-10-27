<script setup lang="ts">
const { usage, load, refresh, refreshing, error } = useClaudeUsage()
onMounted(() => { if (!usage.value) load() })

const NAMES: Record<string, string> = { five_hour: '5 hours', seven_day: 'Week', seven_day_opus: 'Week · Opus', seven_day_sonnet: 'Week · Sonnet' }
const now = ref(Date.now() / 1000)
let tick: any
onMounted(() => (tick = setInterval(() => (now.value = Date.now() / 1000), 30_000)))
onBeforeUnmount(() => clearInterval(tick))

function resets(t: number) {
  const s = t - now.value
  if (s <= 0) return 'reset'
  if (s < 3600) return `resets in ${Math.ceil(s / 60)} min`
  if (s < 86400) return `resets in ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
  return 'resets ' + new Date(t * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}
const tone = (u: number) => (u >= 0.9 ? 'bad' : u >= 0.7 ? 'warn' : 'ok')
</script>

<template>
  <div class="usage small">
    <div class="head">
      <span class="muted">Claude plan</span>
      <span v-if="usage?.limited" class="pill bad">limit reached</span>
      <button class="btn ghost ico" :disabled="refreshing" title="check now (one tiny Haiku call)" @click="refresh">
        <span :class="{ spin: refreshing }"><Icon name="refresh" :size="16"/></span>
      </button>
    </div>
    <template v-if="usage?.windows && Object.keys(usage.windows).length">
      <div v-for="(w, k) in usage.windows" :key="k" class="win" :title="`${Math.round(w.used * 100)}% used`">
        <div class="row"><span>{{ NAMES[k] ?? k }}</span><b :class="tone(w.used)">{{ Math.round(w.used * 100) }}%</b></div>
        <div class="bar"><span :class="tone(w.used)" :style="{ width: Math.min(100, w.used * 100) + '%' }" /></div>
        <div class="faint">{{ resets(w.resets) }}</div>
      </div>
      <div class="faint" :title="new Date(usage.at! * 1000).toLocaleString()">as of {{ ago(usage.at!) }}</div>
    </template>
    <div v-else class="faint">no numbers yet — press refresh</div>
    <div v-if="error" class="bad">{{ error }}</div>
  </div>
</template>

<style scoped>
.usage { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 10px; }
.head { display: flex; align-items: center; gap: 6px; }
.head .muted { flex: 1; }
.ico { padding: 0; width: 24px; height: 24px; border-radius: 6px; font-size: 14px; }
@media (pointer: coarse) { .ico { width: 34px; height: 34px; border-radius: var(--radius-sm); } }
.spin { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg) } }
.win { display: flex; flex-direction: column; gap: 3px; }
.row { display: flex; justify-content: space-between; }
.bar { height: 5px; border-radius: 3px; background: var(--track); overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: 3px; background: var(--ok); }
.bar span.warn { background: var(--warn); }
.bar span.bad { background: var(--bad); }
</style>
