<script setup lang="ts">
defineProps<{ host: any, updates: any }>()
</script>

<template>
  <Panel id="host" title="Host" :sub="host.cpuModel?.replace(/\(R\)|\(TM\)|11th Gen| @.*/g, '').trim()">
    <Meter label="CPU" :value="host.cpu ?? 0" :detail="`${host.cpus} threads`" />
    <Meter label="Memory" :value="pct(host.mem.used, host.mem.total)" :detail="`${bytes(host.mem.used)} / ${bytes(host.mem.total, 0)}`" />
    <div class="stats">
      <Stat label="Load 1m" :value="host.load[0]?.toFixed(2) ?? '–'" :title="`1m / 5m / 15m: ${host.load.join(' / ')}`" />
      <Stat label="CPU temp" :value="host.temps.cpu != null ? `${host.temps.cpu}°C` : '–'" :tone="host.temps.cpu > 80 ? 'warn' : ''" />
      <Stat label="Uptime" :value="duration(host.uptime)" />
      <Stat label="Updates" :value="updates?.host?.count ?? '–'" :tone="updates?.host?.count ? 'warn' : ''" />
    </div>
    <div class="faint small foot">{{ host.pveVersion?.split('/').slice(0, 2).join(' ') }} · kernel {{ host.kernel }}</div>
  </Panel>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 16px; }
.foot { margin-top: 12px; }
</style>
