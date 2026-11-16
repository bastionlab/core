<script setup lang="ts">
const props = withDefaults(defineProps<{ label: string, value: number, detail?: string, warn?: number, bad?: number }>(), { warn: 75, bad: 90 })
const v = computed(() => Math.max(0, Math.min(100, props.value || 0)))
</script>

<template>
  <div class="meter">
    <div class="row">
      <span class="label">{{ label }}</span>
      <span class="val"><b>{{ v.toFixed(0) }}%</b> <span v-if="detail" class="muted small">{{ detail }}</span></span>
    </div>
    <div class="track"><div class="fill" :class="tone(v, warn, bad)" :style="{ transform: `scaleX(${v / 100})` }" /></div>
  </div>
</template>

<style scoped>
.meter + .meter { margin-top: 12px; }
.row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
.label { color: var(--muted); font-size: 13px; }
.track { height: 5px; background: var(--track); border-radius: 3px; overflow: hidden; }
/* scaled, not resized: the bar only moves transform (no layout work per frame). The fill is square on purpose: scaling a rounded
   end squashes it to a sliver at low values; the track (rounded, overflow hidden) rounds the start */
.fill { width: 100%; height: 100%; background: var(--accent); transform-origin: left center; transition: transform var(--dur-slow) var(--ease-out); }
.fill.warn { background: var(--warn); } .fill.bad { background: var(--bad); }
</style>
