<script setup lang="ts">
useHead({ title: 'Metrics · Bastion' })
const { t } = useI18n()
const route = useRoute()
const { data: o, error, refresh } = useOverview()
const now = computed(() => o.value?.time ?? Date.now() / 1000)
const list = computed(() => alerts(o.value))
const { jobs, run, dismiss } = useActions()

// sections as tabs (?s=…); an alert's #anchor (host, storage, uptime, …) opens the tab its panel lives in
const SECTIONS: Record<string, string[]> = {
  machine: ['host', 'gpu', 'storage'],
  backups: ['backups'],
  services: ['uptime', 'services', 'infra'],
  containers: ['containers'],
  network: ['tailnet', 'ports'],
}
const tab = usePageTab('machine')
const tabs = computed(() => Object.entries(SECTIONS).map(([key, secs]) => {
  const mine = list.value.filter(a => secs.includes(a.section))
  return { key, label: t(`tabs.${key}`), badge: mine.length || undefined, tone: mine.some(a => a.level === 'bad') ? 'bad' as const : 'warn' as const }
}))
async function follow(hash: string) {
  const id = hash.slice(1)
  const key = Object.keys(SECTIONS).find(k => SECTIONS[k]!.includes(id))
  if (!key) return
  if (tab.value !== key) await navigateTo({ query: { ...route.query, s: key === 'machine' ? undefined : key }, hash })
  await nextTick()
  document.getElementById(id === 'services' ? 'uptime' : id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
watch(() => route.hash, h => h && follow(h))
watch(o, (v, old) => { if (v && !old && route.hash) follow(route.hash) })
</script>

<template>
  <div>
    <AskPanel
      scope="metrics" placeholder="Ask about the machine…"
      :examples="['How is my server doing?', 'Back up all services now', 'Anything I should fix or update?', 'What is using the GPU?', 'Which local models can I run well?']"
      @refresh="refresh"
    />
    <AlertsBar :items="list" />
    <JobList :jobs="jobs" @dismiss="dismiss" />
    <div v-if="error && !o" class="bad pad">Could not reach the agent: {{ error.statusMessage || error.message }}</div>
    <PageTabs v-model="tab" :tabs="tabs" />
    <template v-if="!o && !error">
      <Skeleton kind="cards" :n="3" class="sk" />
      <Skeleton kind="rows" :n="6" />
    </template>
    <template v-if="o">
      <div v-if="tab === 'machine'" class="grid cols-3">
        <HostPanel :host="o.host" :updates="o.updates" :busy="o.backups?.busy" @action="(n, a) => run(n, a, refresh)" />
        <GpuPanel :gpu="o.gpu" :cts="o.cts" />
        <StoragePanel :pools="o.pools" :datasets="o.datasets" :smart="o.smart" :now="now" />
      </div>
      <div v-else-if="tab === 'backups'" class="grid"><BackupsPanel :b="o.backups" :now="now" @action="(n, a) => run(n, a, refresh)" /></div>
      <template v-else-if="tab === 'services'">
        <div class="grid"><UptimePanel :uptime="o.uptime ?? []" :services="o.services" :now="now" @action="(n, a) => run(n, a, refresh)" /></div>
        <h2 id="infra" class="sec">Infrastructure</h2>
        <ServicesPanel :services="o.services.filter((s: any) => s.group === 'infra' || s.group === 'ai')" />
      </template>
      <div v-else-if="tab === 'containers'" class="grid">
        <ContainersPanel
          :cts="o.cts" :updates="o.updates" all
          @action="(n, a) => run(n, a, refresh)"
        />
      </div>
      <div v-else-if="tab === 'network'" class="grid">
        <TailnetPanel :t="o.tailnet" :now="now" />
        <PortsPanel :ports="o.ports" :cts="o.cts" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.sk { margin-bottom: 14px; }
</style>
