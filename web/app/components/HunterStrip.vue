<script setup lang="ts">
/** status line of a hunter page (deals, wohnungen, jobs): is the CT 107 poller alive, plus the page's own numbers */
const props = defineProps<{ st: any, maxAge: number, pending: boolean }>()
defineEmits<{ reload: [] }>()
// null = nothing to judge yet (no search, or the first run hasn't finished)
const ok = computed(() => (!props.st.searches || !props.st.last_poll ? null : Date.now() / 1000 - props.st.last_poll < props.maxAge))
</script>

<template>
  <div class="strip small">
    <span class="dot" :class="ok === null ? '' : ok ? 'ok' : 'bad'" />
    <span :class="ok === false ? 'bad' : 'muted'" :title="st.last_poll ? new Date(st.last_poll * 1000).toLocaleString('de-DE') : ''">
      {{ !st.searches ? 'no search' : !st.last_poll ? 'first run…' : `${ok ? 'running' : 'stalled'} · ${vor(st.last_poll)}` }}
    </span>
    <slot />
    <button class="btn ghost ref" :disabled="pending" :title="$t('common.refresh')" :aria-label="$t('common.refresh')" @click="$emit('reload')"><Icon name="refresh" :size="16"/></button>
  </div>
  <div v-for="e in st.errors ?? []" :key="e.name" class="small bad q">{{ e.name }}: {{ e.error }}</div>
</template>

<style scoped>
.strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 2px 12px; }
.strip :deep(b) { color: var(--text); font-weight: 600; }
.strip .ref { margin-left: auto; padding: 2px 8px; }
/* phone: the stats wrap, the reload button stays top right instead of dropping onto a line of its own */
@media (max-width: 640px) {
  .strip { position: relative; padding-right: 34px; gap: 4px 12px; }
  .strip .ref { position: absolute; top: -3px; right: 0; }
  .strip :deep(.src) { display: none; }
}
.q { margin: -6px 2px 10px; }
</style>
