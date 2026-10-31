<script setup lang="ts">
/** search box + kind chips (All / Add-ons / Designs / Widgets with counts) for the Add-ons page; extra controls go in the slot */
defineProps<{ kinds: { key: string, label: string, n: number }[], kind: string }>()
const q = defineModel<string>('q', { default: '' })
defineEmits<{ kind: [key: string] }>()
</script>

<template>
  <div class="afbar">
    <input v-model="q" type="search" class="afsearch" :placeholder="$t('market.search')" :aria-label="$t('market.search')">
    <div class="afrow">
      <button v-for="k in kinds" :key="k.key" type="button" class="chip" :class="{ on: kind === k.key }" @click="$emit('kind', k.key)">{{ k.label }} {{ k.n }}</button>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.afbar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.afsearch { width: 100%; max-width: 360px; }
.afrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
@media (pointer: coarse) { .afrow .chip { min-height: 32px; } }
</style>
