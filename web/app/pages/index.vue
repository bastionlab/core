<script setup lang="ts">
useHead({ title: 'pve' })
const { data: o, error, refresh } = useOverview()
const { data: m, refresh: refreshMedia } = useMedia()
usePoll(refreshMedia, 30000)

const list = computed(() => alerts(o.value))
const apps = computed(() => (o.value?.services ?? []).filter((s: any) => s.group === 'app'))
const down = computed(() => apps.value.filter((s: any) => !s.up).length)

const downloading = computed(() => Object.values(m.value?.queues ?? {}).flat().filter((i: any) => i?.speed).length)
const vpnOk = computed(() => m.value?.vpn && m.value.vpn.up && m.value.vpn.killSwitch && !m.value.vpn.leaking)

const { data: boxes, refresh: refreshProjects } = useProjects()
const { data: deals, refresh: refreshDeals } = useDeals()
onMounted(() => { if (!boxes.value) refreshProjects(); if (!deals.value) refreshDeals() })
const dealsFresh = computed(() => (deals.value?.feed ?? []).filter((i: any) => Date.now() / 1000 - (i.posted_at ?? 0) < 86400).length)
const projects = computed(() => (boxes.value ?? []).flatMap(b => b.projects ?? []))
const previews = computed(() => projects.value.filter((p: any) => p.running).length)
const claudes = computed(() => projects.value.filter((p: any) => p.cc?.running).length)

const running = computed(() => (o.value?.cts ?? []).filter((c: any) => c.status === 'running').length)
const updates = computed(() => (o.value?.updates?.host?.count ?? 0)
  + Object.values(o.value?.updates?.cts ?? {}).reduce((s: number, u: any) => s + (u?.count ?? 0), 0))

/** the glance band right under the header — the whole house in eight numbers */
const band = computed(() => [
  { label: 'Containers', value: o.value ? `${running.value}/${o.value.cts.length}` : '–' },
  { label: 'CPU', value: o.value ? `${o.value.host.cpu ?? '–'}%` : '–', tone: (o.value?.host?.cpu ?? 0) > 85 ? 'warn' : '' },
  { label: 'RAM', value: o.value ? `${pct(o.value.host.mem.used, o.value.host.mem.total).toFixed(0)}%` : '–' },
  { label: 'GPU', value: o.value?.gpu ? `${o.value.gpu.util ?? 0}%` : '–' },
  { label: 'Downloading', value: m.value ? downloading.value : '–' },
  { label: 'Previews', value: boxes.value ? previews.value : '–', tone: previews.value ? 'ok' : '' },
  { label: 'Updates', value: o.value ? updates.value : '–', tone: updates.value ? 'warn' : '' },
  { label: 'Uptime', value: o.value ? duration(o.value.host.uptime) : '–' },
])

const topics = computed(() => [
  {
    to: '/media', icon: '🍿', name: 'Media', hue: 285,
    line: 'Downloads, the VPN tunnel and what is in the library.',
    chips: m.value
      ? [
          { text: vpnOk.value ? 'VPN ok' : 'VPN needs a look', tone: vpnOk.value ? 'ok' : 'bad' },
          { text: `${downloading.value} downloading` },
          { text: `${bytes(m.value.sizes?.used)} library` },
        ]
      : [{ text: 'loading…' }],
  },
  {
    to: '/dev', icon: '⌨️', name: 'Dev', hue: 210,
    line: 'Projects on the dev boxes, previews, GitHub and Claude Code.',
    chips: boxes.value
      ? [
          { text: `${projects.value.length} projects` },
          { text: `${previews.value} previews`, tone: previews.value ? 'ok' : '' },
          { text: `${claudes.value} Claude`, tone: claudes.value ? 'accent' : '' },
        ]
      : [{ text: 'loading…' }],
  },
  {
    to: '/deals', icon: '🏷️', name: 'Deals', hue: 95,
    line: 'Kleinanzeigen finds in Berlin, pushed to Telegram the moment they appear.',
    chips: deals.value
      ? [
          { text: `${deals.value.status?.enabled ?? 0} searches` },
          { text: `${dealsFresh.value} new today`, tone: dealsFresh.value ? 'accent' : '' },
        ]
      : [{ text: 'loading…' }],
  },
  {
    to: '/metrics', icon: '📊', name: 'Metrics', hue: 150,
    line: 'Host, GPU, storage, backups, ports — and the update buttons.',
    chips: o.value
      ? [
          { text: list.value.length ? `${list.value.length} alerts` : 'no alerts', tone: list.value.some(a => a.level === 'bad') ? 'bad' : list.value.length ? 'warn' : 'ok' },
          { text: `${updates.value} updates`, tone: updates.value ? 'warn' : '' },
        ]
      : [{ text: 'loading…' }],
  },
  {
    to: '/chat', icon: '✦', name: 'Chat', hue: 25,
    line: 'Talk to the local models with history, web search and actions.',
    chips: [{ text: 'granite · qwen3.6', tone: 'accent' }],
  },
])
</script>

<template>
  <div>
    <AskPanel
      scope="home" placeholder="Ask anything about the house server…"
      :examples="['Is everything working?', 'What is new on Jellyfin?', 'Anything I should fix?', 'What is the weather today?']"
      @refresh="refresh"
    />

    <AlertsBar :items="list" />
    <div v-if="error && !o" class="bad pad">Could not reach the agent: {{ error.statusMessage || error.message }}</div>

    <div class="band">
      <div v-for="b in band" :key="b.label" class="cell">
        <span class="small muted">{{ b.label }}</span>
        <b :class="b.tone">{{ b.value }}</b>
      </div>
    </div>

    <h2 class="sec">
      Apps
      <span class="muted small">{{ apps.length }} services{{ down ? ` · ${down} down` : ' · all up' }}</span>
    </h2>
    <AppTiles v-if="apps.length" :services="apps" />

    <h2 class="sec">Sections <span class="muted small">everything else the dashboard can do</span></h2>
    <div class="topics">
      <NuxtLink v-for="t in topics" :key="t.to" :to="t.to" class="topic" :style="{ '--h': t.hue }">
        <span class="glyph">{{ t.icon }}</span>
        <span class="head">
          <span class="name">{{ t.name }}</span>
          <span class="go">→</span>
        </span>
        <span class="small muted line">{{ t.line }}</span>
        <span class="chips">
          <span v-for="c in t.chips" :key="c.text" class="pill" :class="c.tone">{{ c.text }}</span>
        </span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.sec { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--muted); margin: 24px 0 12px; display: flex; gap: 10px; align-items: baseline; }
.sec .small { text-transform: none; letter-spacing: 0; font-weight: 400; }

.band {
  display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 10px;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px;
}
.cell { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.cell + .cell { border-left: 1px solid var(--line); padding-left: 10px; }
.cell b { font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.topics { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.topic {
  position: relative; display: flex; flex-direction: column; gap: 6px; overflow: hidden;
  padding: 16px; border-radius: 14px; color: var(--text);
  background: linear-gradient(160deg, color-mix(in srgb, hsl(var(--h) 70% 55%) 9%, var(--panel)), var(--panel) 65%);
  border: 1px solid var(--line); transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.topic:hover {
  text-decoration: none; transform: translateY(-3px);
  border-color: color-mix(in srgb, hsl(var(--h) 70% 55%) 45%, var(--line));
  box-shadow: 0 10px 24px -14px hsl(var(--h) 70% 40% / .7);
}
.glyph { position: absolute; right: -6px; top: -10px; font-size: 64px; opacity: .1; pointer-events: none; }
.head { display: flex; align-items: center; gap: 8px; }
.name { font-weight: 600; font-size: 16px; }
.go { margin-left: auto; color: var(--muted); }
.line { min-height: 2.6em; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }

@media (max-width: 1100px) { .band { grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 14px; } .cell:nth-child(4n + 1) { border-left: 0; padding-left: 0; } }
@media (max-width: 640px) { .band { grid-template-columns: repeat(2, minmax(0, 1fr)); } .cell:nth-child(odd) { border-left: 0; padding-left: 0; } .cell:nth-child(4n + 1) { border-left: 0; } }
</style>
