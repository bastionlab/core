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
    <div class="track"><div class="fill" :class="tone(v, warn, bad)" :style="{ width: v + '%' }" /></div>
  </div>
</template>

<style scoped>
.meter + .meter { margin-top: 12px; }
.row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
.label { color: var(--muted); }
.track { height: 6px; background: var(--track); border-radius: 3px; overflow: hidden; }
.fill { height: 100%; border-radius: 3px; background: var(--accent); transition: width .6s ease; }
.fill.warn { background: var(--warn); } .fill.bad { background: var(--bad); }
</style>
