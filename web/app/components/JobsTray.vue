<script setup lang="ts">
/** running + recent actions from every page (opened by <JobsButton> or a toast's "View log"); follows you across pages */
const { jobs, tray, dismiss } = useRuns()
const done = computed(() => jobs.value.filter(j => j.state === 'done' || j.state === 'failed'))
const clear = () => { for (const j of done.value) dismiss(j) }
watch(() => jobs.value.length, n => { if (!n) tray.value = { open: false } })
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') tray.value = { open: false } }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="tray.open && jobs.length" class="tray-scrim" @click.self="tray = { open: false }">
      <div class="tray" role="dialog" aria-label="Jobs">
        <div class="th">
          <b>Jobs</b>
          <button v-if="done.length" type="button" class="lnk small" @click="clear">Clear finished</button>
          <button type="button" class="btn ghost sm" aria-label="Close" @click="tray = { open: false }">✕</button>
        </div>
        <JobList :jobs="jobs" :focus="tray.focus" @dismiss="dismiss" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tray-scrim { position: fixed; inset: 0; z-index: 70; }
.tray {
  position: absolute; left: 212px; bottom: 16px; width: min(460px, calc(100vw - 28px)); max-height: 70vh; overflow-y: auto;
  background: var(--panel); border: 1px solid var(--line-2); border-radius: var(--radius); padding: 10px 10px 2px;
  box-shadow: 0 16px 40px rgb(0 0 0 / .5);
}
.th { display: flex; align-items: center; gap: 10px; margin: 0 0 8px 4px; }
.th b { flex: 1; }
@media (max-width: 900px) { .tray { left: 76px; } }
@media (max-width: 640px) {
  .tray-scrim { background: rgb(0 0 0 / .45); }
  .tray { left: 8px; right: 8px; width: auto; bottom: auto; top: calc(env(safe-area-inset-top, 0px) + 52px); }
}
</style>
