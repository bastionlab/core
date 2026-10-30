<script setup lang="ts">
const props = defineProps<{ b: any, now: number }>()
const emit = defineEmits<{ action: [string, any] }>()
const age = (t?: number | null, max = 26 * 3600) => (!t ? 'warn' : props.now - t > max ? 'bad' : 'ok')
/** the last run failed even though an older archive is still there → red, whatever its age */
const state = (v: any) => (v.run && !v.run.ok && v.run.time >= (v.time ?? 0) ? 'bad' : age(v.time))
const nights = computed(() => [...(props.b.history ?? [])].reverse())
</script>

<template>
  <Panel id="backups" title="Backups" fold="phone" :sub="`daily ${b.vzdumpJobs[0]?.schedule ?? '–'}`">
    <template #actions>
      <button
        class="btn" :disabled="b.busy?.length"
        :title="b.busy?.length ? b.busy.join('\n') : 'vzdump every container now, snapshot mode — nothing is stopped'"
        @click="emit('action', 'backup_all', {})"
      >
        <Icon name="download" :size="16"/> Back up all<span v-if="b.busy?.length" class="pill warn">busy</span>
      </button>
    </template>
    <div v-if="nights.length" class="nights small faint" title="last vzdump runs, oldest → newest">
      runs <span v-for="t in nights" :key="t.time" class="night" :class="t.status === 'OK' ? 'ok' : t.status ? 'bad' : 'warn'" :title="`${clock(t.time)} · ${t.id ? 'CT ' + t.id : 'all'} · ${t.status ?? 'running'}`" />
    </div>
    <div class="scroll-x">
    <table>
      <thead><tr><th>Container</th><th>Last</th><th class="num">Size</th><th class="num kept">Kept</th><th /></tr></thead>
      <tbody>
        <tr v-for="v in b.vzdump" :key="v.vmid">
          <td class="nw"><span class="dot" :class="state(v)" /> &nbsp;<span class="vmid faint">{{ v.vmid }}</span><span class="muted">{{ v.name }}</span></td>
          <td v-if="state(v) === 'bad' && v.run && !v.run.ok" class="nw bad" :title="v.run.error ?? 'did not finish'">failed {{ ago(v.run.time, now) }}</td>
          <td v-else class="nw" :class="age(v.time) === 'ok' ? '' : age(v.time)">{{ v.time ? ago(v.time, now) : 'never' }}</td>
          <td class="num muted">{{ bytes(v.size) }}</td>
          <td class="num muted kept">{{ v.count }}</td>
          <td class="num"><button class="btn ghost small" :disabled="b.busy?.length" title="vzdump this container now" @click="emit('action', 'backup_ct', { vmid: v.vmid })" :aria-label="$t('backup.now')"><Icon name="download" :size="16"/></button></td>
        </tr>
      </tbody>
    </table>
    </div>

    <div class="zfs">
      <div class="job">
        <div><b>sanoid</b> <span class="faint small">tank</span></div>
        <span class="pill" :class="b.sanoid.result === 'success' ? 'ok' : 'bad'">{{ b.sanoid.result }}</span>
        <span class="small muted">ran {{ ago(b.sanoid.last, now) }} · next {{ ago(b.sanoid.next, now) }}</span>
      </div>
      <div class="job">
        <div><b>syncoid</b> <span class="faint small">tank → backup</span></div>
        <span class="pill" :class="b.syncoid.result !== 'success' ? 'bad' : age(b.syncoid.last)">{{ b.syncoid.result }}</span>
        <span class="small muted">ran {{ ago(b.syncoid.last, now) }} · next {{ ago(b.syncoid.next, now) }}</span>
      </div>
      <div class="snaps">
        <span v-for="d in b.sanoid.datasets" :key="d.name" class="small" :title="d.snap">
          <span class="dot" :class="age(d.time)" /> {{ d.name.replace('tank/', '') }} <span class="muted">{{ ago(d.time, now) }}</span>
        </span>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.nw { white-space: nowrap; }
.vmid { margin-right: 8px; }
@media (max-width: 640px) { .kept, .vmid { display: none; } }
.zfs { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
.job { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; }
.job > .small { grid-column: 1 / -1; }
.snaps { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; }
.nights { display: flex; align-items: center; gap: 3px; margin: -6px 0 10px; }
.night { width: 8px; height: 8px; border-radius: 2px; background: var(--faint); }
.night:first-of-type { margin-left: 5px; }
.night.ok { background: var(--ok); } .night.bad { background: var(--bad); } .night.warn { background: var(--warn); }
.snaps .dot { width: 6px; height: 6px; box-shadow: none; margin-right: 2px; }
</style>
