<script setup lang="ts">
/**
 * Power off sits behind two clicks, the second arming after 2 s, because it takes every container and
 * this dashboard down with it. The agent schedules it one minute out, which is the undo window.
 */
const props = defineProps<{ host: any, updates: any, busy?: string[] }>()
const emit = defineEmits<{ action: [string, any] }>()

const step = ref<0 | 1 | 2>(0) // 0 idle, 1 confirm shown, 2 confirm armed
let armTimer: any
function ask() {
  step.value = 1
  clearTimeout(armTimer)
  armTimer = setTimeout(() => { if (step.value === 1) step.value = 2 }, 2000)
}
function cancel() { step.value = 0; clearTimeout(armTimer) }
function powerOff() { cancel(); emit('action', 'host_shutdown', {}) }
onBeforeUnmount(() => clearTimeout(armTimer))

const pending = computed(() => props.host.shutdown)
const at = computed(() => pending.value && new Date(pending.value.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
</script>

<template>
  <Panel id="host" title="Host" :sub="host.cpuModel?.replace(/\(R\)|\(TM\)|11th Gen| @.*/g, '').trim()">
    <template #actions>
      <button
        v-if="!pending" class="btn ghost small" :disabled="busy?.length || step > 0"
        :title="busy?.length ? `not now — ${busy.join('\n')}` : 'power off the whole server (all containers and this dashboard)'"
        @click="ask"
      >⏻ Shut down</button>
    </template>

    <div v-if="pending" class="warnbox">
      <b>{{ pending.mode === 'reboot' ? 'Rebooting' : 'Powering off' }} at {{ at }}.</b>
      <span class="small">Every container stops and this page goes offline.</span>
      <button class="btn" @click="emit('action', 'host_shutdown_cancel', {})">Cancel shutdown</button>
    </div>
    <div v-else-if="step" class="warnbox">
      <b>Power off the server?</b>
      <span class="small">All containers stop — media, AI, dev boxes and this dashboard. It happens one minute after you confirm; you can cancel within that minute.</span>
      <div class="row">
        <button class="btn ghost" @click="cancel">Keep running</button>
        <button class="btn solid-bad" :disabled="step !== 2" @click="powerOff">Yes, power off</button>
      </div>
    </div>

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
.warnbox { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; padding: 12px; border: 1px solid var(--bad); border-radius: var(--radius); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.warnbox .btn { align-self: flex-start; }
.row { display: flex; gap: 8px; }
.btn.solid-bad { background: var(--bad); border-color: var(--bad); color: #fff; }
.btn.solid-bad:disabled { opacity: .45; }
</style>
