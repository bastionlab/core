<script setup lang="ts">
useHead({ title: 'Metrics · Bastion' })
const { data: o, error, refresh } = useOverview()
const now = computed(() => o.value?.time ?? Date.now() / 1000)
const list = computed(() => alerts(o.value))
const { jobs, run, dismiss } = useActions()

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

    <template v-if="!o && !error">
      <Skeleton kind="cards" :n="3" class="sk" />
      <Skeleton kind="rows" :n="6" />
    </template>
    <template v-if="o">
      <div class="grid cols-3">
        <HostPanel :host="o.host" :updates="o.updates" :busy="o.backups?.busy" @action="(n, a) => run(n, a, refresh)" />
        <GpuPanel :gpu="o.gpu" :cts="o.cts" />
        <StoragePanel :pools="o.pools" :datasets="o.datasets" :smart="o.smart" :now="now" />
      </div>

      <div class="grid cols-2">
        <BackupsPanel :b="o.backups" :now="now" @action="(n, a) => run(n, a, refresh)" />
        <TailnetPanel :t="o.tailnet" :now="now" />
      </div>

      <div class="grid"><UptimePanel :uptime="o.uptime ?? []" :services="o.services" :now="now" @action="(n, a) => run(n, a, refresh)" /></div>

      <div class="grid">
        <ContainersPanel
          :cts="o.cts" :updates="o.updates" all
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
.sk { margin-bottom: 14px; }
</style>
