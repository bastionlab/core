<script setup lang="ts">
/** every restartable service: process state + start time from the agent, reachability from the web probe,
 *  and a restart button that needs a second tap within a few seconds */
const props = defineProps<{ uptime: any[], services: any[], now: number }>()
const emit = defineEmits<{ action: [string, any] }>()
const probe = computed(() => new Map(props.services.map(s => [s.name.toLowerCase().replace(/ /g, '-'), s])))
function tone(u: any) {
  if (u.state !== 'running') return 'bad'
  const p = probe.value.get(u.name)
  return p && !p.up ? 'warn' : 'ok'
}
const label = (u: any) => (u.state === 'running' ? (u.since ? `up ${duration(props.now - u.since)}` : 'running') : u.state === 'ct-stopped' ? `CT ${u.ct} stopped` : u.state)
const down = computed(() => props.uptime.filter(u => tone(u) !== 'ok').length)

const armed = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
function restart(u: any) {
  clearTimeout(timer)
  if (armed.value !== u.name) {
    armed.value = u.name
    timer = setTimeout(() => (armed.value = null), 4000)
    return
  }
  armed.value = null
  emit('action', 'service_restart', { service: u.name })
}
</script>

<template>
  <Panel id="uptime" title="Service uptime" fold="phone" :sub="down ? `${down} need a look` : `${uptime.length} running`">
    <div class="rows">
      <div v-for="u in uptime" :key="u.name" class="row">
        <span class="dot" :class="tone(u)" :title="probe.get(u.name) ? (probe.get(u.name).up ? `web check ${probe.get(u.name).ms} ms` : 'web check failing') : ''" />
        <span class="name">{{ u.name }} <span class="faint small">CT {{ u.ct }}</span></span>
        <span class="small" :class="tone(u) === 'ok' ? 'muted' : tone(u)" :title="u.since ? `since ${clock(u.since)}` : ''">
          {{ label(u) }}<template v-if="u.restarts"> · {{ u.restarts }}× auto-restarted</template>
        </span>
        <button
          class="btn sm" :class="armed === u.name ? 'danger' : 'ghost'" :disabled="u.state === 'ct-stopped'"
          :title="`restart ${u.name} in CT ${u.ct}`" @click="restart(u)"
        >
          {{ armed === u.name ? 'Restart?' : '↻' }}
        </button>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 18px; }
.row { display: grid; grid-template-columns: auto minmax(80px, 1fr) minmax(0, max-content) auto; align-items: center; gap: 10px; min-height: 34px; }
.row .dot { width: 7px; height: 7px; box-shadow: none; }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
@media (max-width: 640px) { .rows { grid-template-columns: minmax(0, 1fr); } }
</style>
