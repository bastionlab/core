<script setup lang="ts">
useHead({ title: 'Media · pve' })
const { data: m, error, pending, refresh } = useMedia()
usePoll(refresh, 8000)

const q = computed(() => m.value?.queues ?? {})
const video = computed(() => [...(q.value.movies ?? []), ...(q.value.series ?? [])])
const busy = computed(() => Object.values(q.value).flat().filter((i: any) => (i?.speed ?? 0) > 0).length)
</script>

<template>
  <div>
    <AskPanel
      scope="media" placeholder="Ask about downloads, the VPN or the library…"
      :examples="['Is the VPN actually protecting me?', 'What is downloading right now?', 'How much space is the library using?', 'Is anything stuck?']"
      @refresh="refresh"
    />

    <div v-if="!m && pending" class="muted pad">Loading the download stack…</div>
    <div v-else-if="error && !m" class="bad pad">Could not read the media stack: {{ error.statusMessage || error.message }}</div>

    <template v-if="m">
      <div class="grid cols-2">
        <VpnPanel :vpn="m.vpn" />
        <LibraryPanel :library="m.library" :sizes="m.sizes" />
      </div>

      <h2 class="sec">Downloading <span class="muted small">{{ busy ? `${busy} downloading right now` : 'nothing moving right now' }}</span></h2>
      <div class="grid cols-3">
        <QueuePanel id="q-video" title="Films & series" :items="video" empty="No films or episodes queued" />
        <QueuePanel id="q-music" title="Music" :items="q.music ?? []" empty="Nothing queued in Lidarr" />
        <QueuePanel id="q-books" title="Audiobooks" :items="q.books ?? []" empty="Nothing queued in LazyLibrarian" />
      </div>

      <div class="grid"><Panel title="Torrents" :sub="`${m.torrents?.total ?? 0} in qBittorrent`">
        <div class="stats">
          <Stat label="Downloading" :value="m.torrents?.downloading ?? 0" />
          <Stat label="Seeding" :value="m.torrents?.seeding ?? 0" />
          <Stat label="Down" :value="`${bytes(m.vpn?.speed?.down)}/s`" />
          <Stat label="Up" :value="`${bytes(m.vpn?.speed?.up)}/s`" />
        </div>
        <div v-if="m.torrents?.errored?.length" class="small bad err">
          <div v-for="e in m.torrents.errored" :key="e">errored: {{ e }}</div>
        </div>
      </Panel></div>

      <h2 class="sec">The apps behind it <span class="muted small">admin UIs, LAN only, no login</span></h2>
      <ServicesPanel :services="m.services ?? []" />
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.sec { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--muted); margin: 22px 0 10px; display: flex; gap: 10px; align-items: baseline; }
.sec .small { text-transform: none; letter-spacing: 0; font-weight: 400; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.err { margin-top: 10px; }
</style>
