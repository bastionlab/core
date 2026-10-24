<script setup lang="ts">
/** "Angebote · Passend 12 · Aussortiert 3" heading plus one tab per search, shared by the hunter pages.
 *  The default slot goes at the end of the tab row (deals puts its shipping switch there). */
defineProps<{ title: string, views: readonly { v: string, label: string, n?: number }[], tabs: { id: number | null, name: string, hits: number, enabled: boolean }[] }>()
const show = defineModel<string>('show', { required: true })
const selected = defineModel<number | null>('selected', { required: true })
const slots = useSlots()
</script>

<template>
  <h2 class="sec">
    {{ title }}
    <span class="views">
      <button v-for="v in views" :key="v.v" class="vw" :class="{ on: show === v.v }" @click="show = v.v">
        {{ v.label }} <span class="n">{{ v.n ?? 0 }}</span>
      </button>
    </span>
  </h2>
  <slot name="note" />
  <div v-if="tabs.length > 2 || slots.default" class="tabs">
    <template v-if="tabs.length > 2">
      <button
        v-for="t in tabs" :key="t.id ?? 'all'" class="chip"
        :class="{ on: selected === t.id, off: !t.enabled }"
        @click="selected = t.id"
      >{{ t.name }} <span class="n">{{ t.hits }}</span></button>
    </template>
    <slot />
  </div>
</template>

<style scoped>
.sec { flex-wrap: wrap; }
.views { margin-left: auto; display: flex; flex-wrap: wrap; gap: 2px; font-weight: 400; }
.vw { padding: 3px 9px; border-radius: var(--radius-sm); border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.vw.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.n { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; align-items: center; }
.chip.off { opacity: .55; }
@media (max-width: 560px) { .views { margin-left: 0; } }
@media (pointer: coarse) { .views { gap: 4px; } .vw { min-height: 32px; padding: 4px 10px; } }
</style>
