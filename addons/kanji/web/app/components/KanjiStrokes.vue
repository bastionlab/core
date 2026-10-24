<script setup lang="ts">
/** KanjiVG stroke order, drawn one stroke after another; tap to replay */
const props = defineProps<{ k: string }>()
const data = ref<{ paths: string[], nums: number[][] } | null>(null)
const error = ref('')
const run = ref(0)
watch(() => props.k, async (k) => {
  data.value = null; error.value = ''
  try { data.value = await $fetch(`/api/kanji/strokes`, { query: { k } }) } catch (e: any) { error.value = e?.data?.statusMessage || 'no stroke order' }
}, { immediate: true })
const STEP = 0.45 // seconds per stroke
</script>

<template>
  <div class="strokes">
    <svg v-if="data" :key="run" viewBox="0 0 109 109" role="img" :aria-label="`stroke order of ${k}`" @click="run++">
      <path v-for="(d, i) in data.paths" :key="`g${i}`" :d="d" class="ghost" />
      <path v-for="(d, i) in data.paths" :key="i" :d="d" pathLength="1" class="ink" :style="{ animationDelay: `${i * STEP}s` }" />
      <text v-for="([x, y, n], i) in data.nums" :key="`n${i}`" :x="x" :y="y" class="num" :style="{ animationDelay: `${i * STEP}s` }">{{ n }}</text>
    </svg>
    <div v-else class="faint small ph">{{ error || 'Loading…' }}</div>
    <button v-if="data" type="button" class="lnk small" @click="run++">Replay</button>
  </div>
</template>

<style scoped>
.strokes { display: flex; flex-direction: column; align-items: center; gap: 4px; }
svg { width: 140px; height: 140px; background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
path { fill: none; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
.ghost { stroke: var(--line-2); }
.ink { stroke: var(--text); stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw .4s ease-out forwards; }
.num { font-size: 8px; fill: var(--accent); opacity: 0; animation: show .1s forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes show { to { opacity: 1; } }
.ph { width: 140px; height: 140px; display: grid; place-items: center; text-align: center; }
</style>
