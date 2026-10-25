<script setup lang="ts">
const props = withDefaults(defineProps<{ cts: any[], updates: any, title?: string, sub?: string, all?: boolean }>(), { title: 'Containers' })
const emit = defineEmits<{ action: [string, any] }>()

/** pending package updates for one container, or null when the agent could not look */
const pending = (vmid: number) => props.updates?.cts?.[vmid]?.count ?? null
const hostPending = computed(() => props.updates?.host?.count ?? 0)
const totalPending = computed(() => (props.all ? hostPending.value : 0)
  + props.cts.reduce((s, c) => s + (pending(c.vmid) ?? 0), 0))
</script>

<template>
  <Panel :id="all ? 'containers' : 'dev-containers'" :title="title" :sub="sub" :fold="all ? 'phone' : 'closed'">
    <template #actions>
      <button
        v-if="all" class="btn" :class="{ primary: totalPending }"
        :title="`apt update && apt upgrade on the host and every running container (${totalPending} package updates pending)`"
        @click="emit('action', 'apt_upgrade_all', {})"
      >
        ⟳ Update all<span v-if="totalPending" class="pill warn">{{ totalPending }}</span>
      </button>
      <button
        v-if="all" class="btn" :class="{ primary: hostPending }" title="apt upgrade on the host itself"
        @click="emit('action', 'apt_upgrade', { target: 'host' })"
      >
        ⟳ Host<span v-if="hostPending" class="pill warn">{{ hostPending }}</span>
      </button>
    </template>

    <div class="scroll-x">
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>CPU</th><th>Memory</th><th>Disk</th><th class="num">Uptime</th><th class="num">Updates</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="c in cts" :key="c.vmid">
            <td class="mono muted">{{ c.vmid }}</td>
            <td>
              <div class="name">
                <span class="dot" :class="c.status === 'running' ? 'ok' : 'bad'" />
                <b>{{ c.name }}</b>
                <span v-for="t in c.tags" :key="t" class="pill" :class="t === 'dev' ? 'accent' : ''">{{ t }}</span>
              </div>
              <div class="faint small mono">{{ c.ip }}</div>
            </td>
            <td class="w">
              <div class="mini"><i :class="tone(c.cpu * 100)" :style="{ width: Math.min(100, c.cpu * 100) + '%' }" /></div>
              <span class="small muted">{{ (c.cpu * 100).toFixed(0) }}% of {{ c.cpus }}</span>
            </td>
            <td class="w">
              <div class="mini"><i :class="tone(pct(c.mem, c.maxmem))" :style="{ width: pct(c.mem, c.maxmem) + '%' }" /></div>
              <span class="small muted">{{ bytes(c.mem) }} / {{ bytes(c.maxmem, 0) }}</span>
            </td>
            <td class="w">
              <div class="mini"><i :class="tone(pct(c.disk, c.maxdisk))" :style="{ width: pct(c.disk, c.maxdisk) + '%' }" /></div>
              <span class="small muted">{{ bytes(c.disk) }} / {{ bytes(c.maxdisk, 0) }}</span>
            </td>
            <td class="num muted">{{ c.status === 'running' ? duration(c.uptime) : c.status }}</td>
            <td class="num">
              <span v-if="pending(c.vmid) != null" :class="pending(c.vmid) ? 'warn' : 'faint'" :title="updates.cts[c.vmid].packages.join(', ')">
                {{ pending(c.vmid) }}
              </span>
              <span v-else class="faint">–</span>
            </td>
            <td class="num">
              <button
                class="btn ghost small" :class="{ warn: pending(c.vmid) }"
                :disabled="c.status !== 'running'"
                :title="c.status === 'running' ? `apt update && apt upgrade in CT ${c.vmid} ${c.name}` : 'container is not running'"
                @click="emit('action', 'apt_upgrade', { target: c.vmid })"
              >⟳ Update</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="cards">
      <div v-for="c in cts" :key="c.vmid" class="card">
        <div class="ch">
          <span class="dot" :class="c.status === 'running' ? 'ok' : 'bad'" />
          <b>{{ c.name }}</b>
          <span class="faint small mono">{{ c.vmid }}</span>
          <span v-for="t in c.tags" :key="t" class="pill" :class="t === 'dev' ? 'accent' : ''">{{ t }}</span>
          <button
            class="btn ghost small upd" :class="{ warn: pending(c.vmid) }" :disabled="c.status !== 'running'"
            @click="emit('action', 'apt_upgrade', { target: c.vmid })"
          >⟳<span v-if="pending(c.vmid)"> {{ pending(c.vmid) }}</span></button>
        </div>
        <div class="bars">
          <div :title="`${(c.cpu * 100).toFixed(0)}% of ${c.cpus}`"><span class="faint small">CPU</span><div class="mini"><i :class="tone(c.cpu * 100)" :style="{ width: Math.min(100, c.cpu * 100) + '%' }" /></div></div>
          <div :title="`${bytes(c.mem)} / ${bytes(c.maxmem, 0)}`"><span class="faint small">RAM</span><div class="mini"><i :class="tone(pct(c.mem, c.maxmem))" :style="{ width: pct(c.mem, c.maxmem) + '%' }" /></div></div>
          <div :title="`${bytes(c.disk)} / ${bytes(c.maxdisk, 0)}`"><span class="faint small">Disk</span><div class="mini"><i :class="tone(pct(c.disk, c.maxdisk))" :style="{ width: pct(c.disk, c.maxdisk) + '%' }" /></div></div>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
table { min-width: 760px; }
.cards { display: none; }
@media (max-width: 760px) {
  .scroll-x { display: none; }
  .cards { display: flex; flex-direction: column; }
  .card { padding: 10px 0; }
  .card + .card { border-top: 1px solid var(--line); }
  .ch { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .upd { margin-left: auto; }
  .upd.warn { color: var(--warn); }
  .bars { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 6px; padding-left: 16px; }
  .bars .mini { max-width: none; margin-top: 3px; }
}
.name { display: flex; align-items: center; gap: 8px; }
.w { width: 15%; }
.mini { height: 4px; background: var(--track); border-radius: 2px; overflow: hidden; margin-bottom: 3px; max-width: 140px; }
.mini i { display: block; height: 100%; background: var(--accent); }
.mini i.warn { background: var(--warn); } .mini i.bad { background: var(--bad); }
.btn .pill { padding: 0 6px; font-size: 10.5px; }
</style>
