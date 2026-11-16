<script setup lang="ts">
/** the header's jobs button (sidebar on desktop, top bar on phones); the list itself is <JobsTray> */
const { jobs, tray, running } = useRuns()
const failed = computed(() => jobs.value.filter(j => j.state === 'failed' && (j.ended ?? 0) > Date.now() - 3600e3).length)
</script>

<template>
  <Transition name="jt">
  <button v-if="jobs.length" type="button" class="jt" :class="{ on: tray.open }" :aria-expanded="tray.open" @click="tray = { open: !tray.open }">
    <span v-if="running.length" class="spin" />
    <span v-else class="mark" :class="failed ? 'bad' : 'ok'"><Icon :name="failed ? 'x' : 'check'" :size="14"/></span>
    <span class="l">{{ running.length ? `${running.length} running` : 'Jobs' }}</span>
  </button>
  </Transition>
</template>

<style scoped>
.jt { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--panel); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; min-height: 32px; }
.jt.on, .jt:hover { color: var(--text); border-color: var(--faint); }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--accent-soft); border-top-color: var(--accent); animation: spin .8s linear infinite; }
.mark { font-weight: 700; }
.jt-enter-active { transition: opacity var(--dur) var(--ease-out), transform var(--dur) var(--ease-spring); }
.jt-leave-active { transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in); }
.jt-enter-from, .jt-leave-to { opacity: 0; transform: scale(.9); }
</style>
