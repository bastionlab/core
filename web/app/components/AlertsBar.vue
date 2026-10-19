<script setup lang="ts">
const props = defineProps<{ items: Alert[] }>()
const open = ref(false)
const shown = computed(() => (open.value ? props.items : props.items.slice(0, 3)))
</script>

<template>
  <div v-if="items.length" class="alerts">
    <a v-for="(a, i) in shown" :key="i" :href="'#' + a.section" class="alert" :class="a.level">
      <span class="dot" :class="a.level" /> <span>{{ a.text }}</span>
    </a>
    <button v-if="items.length > 3" class="btn ghost small" @click="open = !open">
      {{ open ? 'less' : `+${items.length - 3} more` }}
    </button>
  </div>
</template>

<style scoped>
.alerts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.alert { display: inline-flex; align-items: center; gap: 9px; padding: 7px 12px; border-radius: 9px; font-size: 13px; color: var(--text); min-width: 0; }
.alert:hover { text-decoration: none; filter: brightness(1.15); }
.alert.bad { background: var(--bad-soft); }
.alert.warn { background: var(--warn-soft); }
</style>
