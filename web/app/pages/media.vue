<script setup lang="ts">
useHead({ title: 'Media · pve' })
const { data: m, error, pending, refresh } = useMedia()
usePoll(refresh, 8000)

const q = computed(() => m.value?.queues ?? {})
const queue = computed(() => [...(q.value.movies ?? []), ...(q.value.series ?? []), ...(q.value.books ?? [])])
</script>

<template>
  <div>
    <AskPanel
      scope="media" placeholder="Ask about downloads, the VPN or the library…"
      :examples="['Is the VPN actually protecting me?', 'What is downloading right now?', 'How much space is the library using?', 'Is anything stuck?']"
      @refresh="refresh"
    />

    <div v-if="!m && pending" class="muted pad">Loading…</div>
    <div v-else-if="error && !m" class="bad pad">Could not read the media stack: {{ error.statusMessage || error.message }}</div>

    <template v-if="m">
      <div class="grid cols-2">
        <VpnPanel :vpn="m.vpn" :torrents="m.torrents" />
        <LibraryPanel :library="m.library" :sizes="m.sizes" />
      </div>

      <div class="grid cols-2">
        <QueuePanel id="q-all" title="Queue" :items="queue" empty="Nothing queued" />
        <WatchdogPanel :w="m.watchdog" />
      </div>

      <div class="grid cols-2">
        <MediaRemove @removed="refresh" />
        <Panel title="Admin apps" fold="closed">
          <ServicesPanel :services="m.services ?? []" list />
        </Panel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.grid { align-items: start; }
</style>
