<script setup lang="ts">
const props = defineProps<{ items: Alert[] }>()
const open = ref(false)
const shown = computed(() => (open.value ? props.items : props.items.slice(0, 4)))
</script>

<template>
  <div v-if="items.length" class="alerts">
    <a v-for="(a, i) in shown" :key="i" :href="'#' + a.section" class="alert" :class="a.level">
      <span class="dot" :class="a.level" /> {{ a.text }}
    </a>
    <button v-if="items.length > 4" class="btn ghost small" @click="open = !open">
      {{ open ? 'less' : `+${items.length - 4} more` }}
    </button>
  </div>
  <div v-else class="alerts"><span class="alert okay"><span class="dot ok" /> All good — nothing needs attention</span></div>
</template>

<style scoped>
.alerts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.alert { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 8px; font-size: 13px; color: var(--text); background: var(--panel); border: 1px solid var(--line); }
.alert:hover { text-decoration: none; border-color: var(--faint); }
.alert.bad { background: var(--bad-soft); border-color: transparent; }
.alert.warn { background: var(--warn-soft); border-color: transparent; }
.okay { color: var(--muted); }
</style>
