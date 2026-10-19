<script setup lang="ts">
const props = defineProps<{ gpu: any, cts: any[] }>()
const ctName = (id: number | null) => props.cts.find(c => c.vmid === id)?.name ?? (id ? `CT ${id}` : 'host')
</script>

<template>
  <Panel id="gpu" title="GPU" :sub="gpu?.name?.replace('NVIDIA GeForce ', '')">
    <template v-if="gpu">
      <Meter label="VRAM" :value="pct(gpu.memUsed, gpu.memTotal)" :detail="`${bytes(gpu.memUsed)} / ${bytes(gpu.memTotal, 0)}`" />
      <Meter label="Utilization" :value="gpu.util ?? 0" />
      <div class="stats">
        <Stat label="Temp" :value="gpu.temp != null ? `${gpu.temp}°C` : '–'" :tone="gpu.temp > 80 ? 'warn' : ''" />
        <Stat label="Power" :value="gpu.power != null ? `${gpu.power.toFixed(0)} W` : '–'" />
        <Stat label="Processes" :value="gpu.procs.length" />
      </div>
      <div class="procs">
        <div v-for="p in gpu.procs" :key="p.pid" class="proc">
          <span class="pill accent">{{ ctName(p.ct) }}</span>
          <span class="mono">{{ p.name }}</span>
          <span class="muted small" style="margin-left:auto">{{ bytes(p.mem) }}</span>
        </div>
        <div v-if="!gpu.procs.length" class="faint small">Idle</div>
      </div>
    </template>
    <div v-else class="muted">No GPU data</div>
  </Panel>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 16px; }
.procs { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.proc { display: flex; align-items: center; gap: 8px; }
</style>
