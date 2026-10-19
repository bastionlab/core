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
const { data: flats, refresh: refreshFlats } = useFlats()
const { data: jobs, refresh: refreshJobs } = useJobs()
onMounted(() => { if (!boxes.value) refreshProjects(); if (!deals.value) refreshDeals(); if (!flats.value) refreshFlats(); if (!jobs.value) refreshJobs() })
const flatsFresh = computed(() => (flats.value?.feed ?? []).filter((i: any) => Date.now() / 1000 - (i.posted_at ?? i.first_seen_at ?? 0) < 86400).length)
const dealsFresh = computed(() => (deals.value?.feed ?? []).filter((i: any) => Date.now() / 1000 - (i.posted_at ?? 0) < 86400).length)
const projects = computed(() => (boxes.value ?? []).flatMap(b => b.projects ?? []))
const previews = computed(() => projects.value.filter((p: any) => p.running).length)
const claudes = computed(() => projects.value.filter((p: any) => p.cc?.running).length)

const running = computed(() => (o.value?.cts ?? []).filter((c: any) => c.status === 'running').length)
const updates = computed(() => (o.value?.updates?.host?.count ?? 0)
  + Object.values(o.value?.updates?.cts ?? {}).reduce((s: number, u: any) => s + (u?.count ?? 0), 0))

/** the glance band — the house in a handful of numbers */
const band = computed(() => [
  { label: 'CPU', value: o.value ? `${Math.round(o.value.host.cpu ?? 0)}%` : '–', tone: (o.value?.host?.cpu ?? 0) > 85 ? 'warn' : '' },
  { label: 'RAM', value: o.value ? `${pct(o.value.host.mem.used, o.value.host.mem.total).toFixed(0)}%` : '–' },
  { label: 'GPU', value: o.value?.gpu ? `${o.value.gpu.util ?? 0}%` : '–' },
  { label: 'Containers', value: o.value ? `${running.value}/${o.value.cts.length}` : '–', tone: o.value && running.value < o.value.cts.length ? 'warn' : '' },
  { label: 'Updates', value: o.value ? updates.value : '–', tone: updates.value ? 'warn' : '' },
  { label: 'Uptime', value: o.value ? duration(o.value.host.uptime) : '–' },
])
const health = computed(() => {
  if (!o.value) return { tone: '', text: 'Loading…' }
  const bad = list.value.filter(a => a.level === 'bad').length
  if (bad) return { tone: 'bad', text: `${bad} problem${bad > 1 ? 's' : ''}` }
  if (list.value.length) return { tone: 'warn', text: `${list.value.length} to check` }
  return { tone: 'ok', text: 'All good' }
})

const topics = computed(() => [
  {
    to: '/media', icon: 'media', name: 'Media',
    chips: m.value
      ? [
          { text: vpnOk.value ? 'VPN ok' : 'VPN!', tone: vpnOk.value ? 'ok' : 'bad' },
          ...(downloading.value ? [{ text: `${downloading.value} ↓`, tone: 'accent' }] : []),
          { text: bytes(m.value.sizes?.used) },
        ]
      : [],
  },
  {
    to: '/dev', icon: 'dev', name: 'Dev',
    chips: boxes.value
      ? [
          { text: `${projects.value.length} projects` },
          ...(previews.value ? [{ text: `${previews.value} running`, tone: 'ok' }] : []),
          ...(claudes.value ? [{ text: `${claudes.value} Claude`, tone: 'accent' }] : []),
        ]
      : [],
  },
  {
    to: '/deals', icon: 'deals', name: 'Deals',
    chips: deals.value
      ? [
          { text: `${deals.value.status?.enabled ?? 0} searches` },
          ...(dealsFresh.value ? [{ text: `${dealsFresh.value} new`, tone: 'accent' }] : []),
        ]
      : [],
  },
  {
    to: '/wohnungen', icon: 'key', name: 'Wohnungen',
    chips: flats.value
      ? [
          { text: `${flats.value.status?.enabled ?? 0} Suchen` },
          ...(flatsFresh.value ? [{ text: `${flatsFresh.value} neu`, tone: 'accent' }] : []),
        ]
      : [],
  },
  {
    to: '/jobs', icon: 'briefcase', name: 'Jobs',
    chips: jobs.value
      ? [
          { text: `${jobs.value.status?.enabled ?? 0} Suchen` },
          ...(jobs.value.counts?.passed ? [{ text: `${jobs.value.counts.passed} passend`, tone: 'accent' }] : []),
        ]
      : [],
  },
  {
    to: '/metrics', icon: 'metrics', name: 'Metrics',
    chips: o.value
      ? [
          ...(list.value.length ? [{ text: `${list.value.length} alerts`, tone: list.value.some(a => a.level === 'bad') ? 'bad' : 'warn' }] : []),
          ...(updates.value ? [{ text: `${updates.value} updates`, tone: 'warn' }] : [{ text: 'up to date' }]),
        ]
      : [],
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

    <div v-if="error && !o" class="bad pad">Could not reach the agent: {{ error.statusMessage || error.message }}</div>

    <div class="band">
      <div class="cell health" :class="health.tone">
        <span class="dot" :class="health.tone" />
        <b>{{ health.text }}</b>
      </div>
      <div v-for="b in band" :key="b.label" class="cell">
        <span class="lbl">{{ b.label }}</span>
        <b :class="b.tone">{{ b.value }}</b>
      </div>
    </div>
    <AlertsBar :items="list" />

    <h2 class="sec">Apps <span v-if="down" class="bad small">{{ down }} down</span></h2>
    <AppTiles v-if="apps.length" :services="apps" />

    <h2 class="sec">Sections</h2>
    <div class="topics">
      <NuxtLink v-for="t in topics" :key="t.to" :to="t.to" class="topic">
        <span class="ti"><Icon :name="t.icon" :size="18" /></span>
        <span class="name">{{ t.name }}</span>
        <span class="chips">
          <span v-for="c in t.chips" :key="c.text" class="pill" :class="c.tone">{{ c.text }}</span>
        </span>
        <Icon name="arrow" :size="16" class="go" />
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }

.band {
  display: grid; grid-template-columns: 1.4fr repeat(6, minmax(0, 1fr)); gap: 0;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); margin-bottom: 14px; overflow: hidden;
}
.cell { display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; padding: 14px 16px; }
.cell + .cell { border-left: 1px solid var(--line); }
.lbl { font-size: 12px; color: var(--faint); }
.cell b { font-size: 18px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.health { flex-direction: row; align-items: center; justify-content: flex-start; gap: 12px; }
.health.ok { background: linear-gradient(90deg, var(--ok-soft), transparent); }
.health.warn { background: linear-gradient(90deg, var(--warn-soft), transparent); }
.health.bad { background: linear-gradient(90deg, var(--bad-soft), transparent); }
.health b { font-size: 16px; }

.topics { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.topic {
  display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 14px;
  border-radius: var(--radius); color: var(--text); background: var(--panel); border: 1px solid var(--line);
  transition: border-color .15s, background .15s;
}
.topic:hover { text-decoration: none; border-color: var(--line-2); background: var(--panel-2); }
.ti { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: var(--panel-2); color: var(--muted); flex: none; }
.topic:hover .ti { color: var(--accent); }
.name { font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-left: auto; min-width: 0; }
.go { color: var(--faint); }

@media (max-width: 1100px) {
  .band { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .health { grid-column: 1 / -1; border-bottom: 1px solid var(--line); }
  .cell:nth-child(2), .cell:nth-child(6) { border-left: 0; }
  .cell:nth-child(n + 6) { border-top: 1px solid var(--line); }
}
@media (max-width: 640px) {
  .band { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cell { padding: 11px 12px; }
  .cell:nth-child(6) { border-left: 1px solid var(--line); }
  .cell:nth-child(5) { border-left: 0; }
  .cell:nth-child(n + 5) { border-top: 1px solid var(--line); }
  .cell b { font-size: 16px; }
  .topics { grid-template-columns: minmax(0, 1fr); gap: 8px; }
}
</style>
