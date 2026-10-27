<script setup lang="ts">
// shows only while offline or while queued edits are syncing; tap = sync now
const off = useOffline()
const text = computed(() => {
  const o = off.value
  if (o.state === 'offline') {
    const t = o.at ? ` · last data ${new Date(o.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''
    return `Offline${t}${o.queued ? ` · ${o.queued} queued` : ''}`
  }
  return `Syncing ${o.queued}…`
})
const show = computed(() => off.value.state === 'offline' || off.value.queued > 0)
</script>

<template>
  <button v-if="show" type="button" class="pill offline-pill" :class="off.state === 'offline' ? 'warn' : 'accent'" role="status" @click="off.flush()">
    <span class="dot" :class="off.state === 'offline' ? 'warn' : 'ok'" />{{ text }}
  </button>
</template>

<style scoped>
.offline-pill {
  position: fixed; top: calc(env(safe-area-inset-top, 0px) + 6px); left: 50%; transform: translateX(-50%); z-index: 60;
  max-width: calc(100vw - 24px); font: inherit; font-size: 11.5px; padding: 3px 10px; cursor: pointer;
  background: var(--panel); border: 1px solid var(--line-2); box-shadow: 0 2px 10px rgba(0, 0, 0, .25);
}
</style>
