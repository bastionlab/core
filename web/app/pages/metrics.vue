<script setup lang="ts">
useHead({ title: 'Metrics · pve' })
const { data: o, error, refresh } = useOverview()
const now = computed(() => o.value?.time ?? Date.now() / 1000)
const list = computed(() => alerts(o.value))
const { jobs, run, dismiss } = useActions()

const running = computed(() => (o.value?.cts ?? []).filter((c: any) => c.status === 'running'))
const updates = computed(() => (o.value?.updates?.host?.count ?? 0)
  + Object.values(o.value?.updates?.cts ?? {}).reduce((s: number, u: any) => s + (u?.count ?? 0), 0))
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

    <template v-if="o">
      <div class="grid strip">
        <Stat label="CPU" :value="`${o.host.cpu ?? '–'}%`" />
        <Stat label="RAM" :value="`${pct(o.host.mem.used, o.host.mem.total).toFixed(0)}%`" />
        <Stat label="GPU" :value="o.gpu ? `${o.gpu.util ?? 0}%` : '–'" />
        <Stat label="VRAM" :value="o.gpu ? bytes(o.gpu.memUsed) : '–'" />
        <Stat label="Containers" :value="`${running.length}/${o.cts.length}`" />
        <Stat label="Updates" :value="updates" :tone="updates ? 'warn' : ''" />
        <Stat label="Uptime" :value="duration(o.host.uptime)" />
        <Stat label="Alerts" :value="list.length" :tone="list.some(a => a.level === 'bad') ? 'bad' : list.length ? 'warn' : ''" />
      </div>

      <div class="grid cols-3">
        <HostPanel :host="o.host" :updates="o.updates" :busy="o.backups?.busy" @action="(n, a) => run(n, a, refresh)" />
        <GpuPanel :gpu="o.gpu" :cts="o.cts" />
        <StoragePanel :pools="o.pools" :datasets="o.datasets" :smart="o.smart" />
      </div>

      <div class="grid cols-2">
        <BackupsPanel :b="o.backups" :now="now" @action="(n, a) => run(n, a, refresh)" />
        <TailnetPanel :t="o.tailnet" :now="now" />
      </div>

      <div class="grid">
        <ContainersPanel
          :cts="o.cts" :updates="o.updates" all
          sub="every LXC on the host — update one, or the host and all of them at once"
          @action="(n, a) => run(n, a, refresh)"
        />
      </div>
      <div class="grid"><PortsPanel :ports="o.ports" :cts="o.cts" /></div>

      <h2 class="sec">Infrastructure</h2>
      <ServicesPanel :services="o.services.filter((s: any) => s.group === 'infra' || s.group === 'ai')" />
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.strip { grid-template-columns: repeat(8, minmax(0, 1fr)); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; gap: 10px; }
.sec { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--muted); margin: 22px 0 10px; }
@media (max-width: 900px) { .strip { grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 14px; } }
</style>
