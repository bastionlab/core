<script setup lang="ts">
const { data: o, error, refresh } = useFetch<any>('/api/overview')
const { data: boxes, pending: projPending, refresh: refreshProjects } = useFetch<any[]>('/api/projects')

const list = computed(() => alerts(o.value))
const now = computed(() => o.value?.time ?? Date.now() / 1000)
const updated = ref(Date.now())
watch(o, () => (updated.value = Date.now()))

// poll while the tab is visible
let timers: any[] = []
function start() {
  stop()
  timers = [setInterval(refresh, 5000), setInterval(refreshProjects, 4000)]
}
function stop() { timers.forEach(clearInterval); timers = [] }
function onVis() { if (document.hidden) stop(); else { refresh(); refreshProjects(); start() } }
onMounted(() => { start(); document.addEventListener('visibilitychange', onVis) })
onUnmounted(() => { stop(); document.removeEventListener('visibilitychange', onVis) })

// theme: auto → dark → light
const theme = ref<'auto' | 'dark' | 'light'>('auto')
onMounted(() => { try { theme.value = (localStorage.getItem('theme') as any) || 'auto' } catch {} })
watchEffect(() => {
  if (import.meta.server) return
  if (theme.value === 'auto') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme.value)
  try { localStorage.setItem('theme', theme.value) } catch {}
})
const cycle = () => (theme.value = theme.value === 'auto' ? 'dark' : theme.value === 'dark' ? 'light' : 'auto')

const tick = ref(Date.now())
onMounted(() => timers.push(setInterval(() => (tick.value = Date.now()), 1000)))
const stale = computed(() => tick.value - updated.value > 20000)
</script>

<template>
  <div class="wrap">
    <header class="top">
      <div class="brand">
        <span class="logo">🖥️</span>
        <div>
          <h1>pve</h1>
          <div class="muted small">homelab · {{ o?.cts?.filter((c: any) => c.status === 'running').length ?? '–' }} containers running</div>
        </div>
      </div>
      <nav class="small">
        <a href="#projects">Projects</a><a href="#host">Host</a><a href="#backups">Backups</a><a href="#containers">Containers</a><a href="#ports">Ports</a><a href="#tailnet">Tailnet</a>
      </nav>
      <div class="right small">
        <span v-if="error" class="pill bad">agent unreachable</span>
        <span v-else-if="stale" class="pill warn">stale</span>
        <span class="muted" :title="new Date(updated).toLocaleString()"><span class="dot" :class="error ? 'bad' : stale ? 'warn' : 'ok'" /> live</span>
        <button class="btn ghost" :title="`theme: ${theme}`" @click="cycle">{{ theme === 'auto' ? '◐' : theme === 'dark' ? '☾' : '☀' }}</button>
      </div>
    </header>

    <div v-if="!o && !error" class="muted loading">Loading…</div>
    <div v-if="error && !o" class="loading bad">Could not reach the agent: {{ error.statusMessage || error.message }}</div>

    <template v-if="o">
      <AlertsBar :items="list" />
      <ServicesPanel :services="o.services" />

      <div class="grid"><ProjectsPanel :boxes="boxes" :pending="projPending" @refresh="refreshProjects" /></div>

      <div class="grid cols-3">
        <HostPanel :host="o.host" :updates="o.updates" />
        <GpuPanel :gpu="o.gpu" :cts="o.cts" />
        <StoragePanel :pools="o.pools" :datasets="o.datasets" :smart="o.smart" />
      </div>

      <div class="grid cols-2">
        <BackupsPanel :b="o.backups" :now="now" />
        <TailnetPanel :t="o.tailnet" :now="now" />
      </div>

      <div class="grid"><ContainersPanel :cts="o.cts" :updates="o.updates" /></div>
      <div class="grid"><PortsPanel :ports="o.ports" :cts="o.cts" /></div>
    </template>
  </div>
</template>

<style scoped>
.top { display: flex; align-items: center; gap: 24px; margin-bottom: 18px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 12px; }
.logo { font-size: 24px; width: 42px; height: 42px; display: grid; place-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
h1 { margin: 0; font-size: 20px; line-height: 1.1; }
nav { display: flex; gap: 14px; flex-wrap: wrap; }
nav a { color: var(--muted); }
nav a:hover { color: var(--text); text-decoration: none; }
.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.right .dot { width: 6px; height: 6px; margin-right: 4px; vertical-align: middle; }
.loading { padding: 60px 0; text-align: center; }
@media (max-width: 760px) { nav { display: none; } }
</style>
