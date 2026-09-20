<script setup lang="ts">
useHead({ title: 'pve' })
const { data: o, error, refresh } = useOverview()
const { data: m, refresh: refreshMedia } = useMedia()
usePoll(refreshMedia, 30000)

const list = computed(() => alerts(o.value))
const apps = computed(() => (o.value?.services ?? []).filter((s: any) => s.group === 'app'))

const downloading = computed(() => Object.values(m.value?.queues ?? {}).flat().filter((i: any) => i?.speed).length)
const vpnOk = computed(() => m.value?.vpn && m.value.vpn.up && m.value.vpn.killSwitch && !m.value.vpn.leaking)
const { data: boxes, refresh: refreshProjects } = useProjects()
onMounted(() => { if (!boxes.value) refreshProjects() })
const previews = computed(() => (boxes.value ?? []).flatMap(b => b.projects ?? []).filter((p: any) => p.running).length)

const topics = computed(() => [
  { to: '/media', icon: '🍿', name: 'Media', line: m.value
    ? `${vpnOk.value ? 'VPN ok' : 'VPN needs a look'} · ${downloading.value} downloading · ${bytes(m.value.sizes?.used)} library`
    : 'download stack, VPN and library', tone: m.value && !vpnOk.value ? 'bad' : '' },
  { to: '/dev', icon: '⌨️', name: 'Dev', line: boxes.value ? `${(boxes.value ?? []).flatMap(b => b.projects ?? []).length} projects · ${previews.value} previews running` : 'projects, previews, GitHub, Claude Code' },
  { to: '/metrics', icon: '📊', name: 'Metrics', line: o.value ? `CPU ${o.value.host.cpu ?? '–'}% · RAM ${pct(o.value.host.mem.used, o.value.host.mem.total).toFixed(0)}% · ${list.value.length} alerts` : 'host, GPU, storage, backups', tone: list.value.some(a => a.level === 'bad') ? 'bad' : '' },
  { to: '/chat', icon: '✦', name: 'Chat', line: 'talk to the local models, with history' },
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

    <ServicesPanel v-if="apps.length" :services="apps" />

    <h2 class="sec">Everything else</h2>
    <div class="topics">
      <NuxtLink v-for="t in topics" :key="t.to" :to="t.to" class="topic">
        <span class="icon">{{ t.icon }}</span>
        <span class="body">
          <span class="name">{{ t.name }}</span>
          <span class="small" :class="t.tone || 'muted'">{{ t.line }}</span>
        </span>
        <span class="go muted">→</span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.sec { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--muted); margin: 22px 0 10px; }
.topics { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.topic { display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); color: var(--text); transition: border-color .15s, transform .15s; }
.topic:hover { text-decoration: none; border-color: var(--accent); transform: translateY(-1px); }
.icon { font-size: 22px; width: 36px; height: 36px; display: grid; place-items: center; background: var(--panel-2); border-radius: 8px; flex: none; }
.body { display: flex; flex-direction: column; min-width: 0; }
.body > span { overflow: hidden; text-overflow: ellipsis; }
.name { font-weight: 600; }
.go { margin-left: auto; }
</style>
