<script setup lang="ts">
const props = defineProps<{ b: any, now: number }>()
const emit = defineEmits<{ action: [string, any] }>()
const age = (t?: number | null, max = 26 * 3600) => (!t ? 'warn' : props.now - t > max ? 'bad' : 'ok')
</script>

<template>
  <Panel id="backups" title="Backups" :sub="`vzdump daily ${b.vzdumpJobs[0]?.schedule ?? '–'} → ${b.vzdumpJobs[0]?.storage ?? '–'}`">
    <template #actions>
      <button
        class="btn" :disabled="b.busy?.length"
        :title="b.busy?.length ? b.busy.join('\n') : 'vzdump every container now, snapshot mode — nothing is stopped'"
        @click="emit('action', 'backup_all', {})"
      >
        ⤓ Back up all<span v-if="b.busy?.length" class="pill warn">busy</span>
      </button>
    </template>
    <table>
      <thead><tr><th>Container</th><th>Last vzdump</th><th class="num">Size</th><th class="num">Kept</th><th /></tr></thead>
      <tbody>
        <tr v-for="v in b.vzdump" :key="v.vmid">
          <td><span class="dot" :class="age(v.time)" /> &nbsp;{{ v.vmid }} <span class="muted">{{ v.name }}</span></td>
          <td :class="age(v.time) === 'ok' ? '' : age(v.time)">{{ v.time ? ago(v.time, now) : 'never' }}</td>
          <td class="num muted">{{ bytes(v.size) }}</td>
          <td class="num muted">{{ v.count }}</td>
          <td class="num"><button class="btn ghost small" :disabled="b.busy?.length" title="vzdump this container now" @click="emit('action', 'backup_ct', { vmid: v.vmid })">⤓</button></td>
        </tr>
      </tbody>
    </table>

    <div class="zfs">
      <div class="job">
        <div><b>sanoid</b> <span class="muted small">snapshots tank</span></div>
        <span class="pill" :class="b.sanoid.result === 'success' ? 'ok' : 'bad'">{{ b.sanoid.result }}</span>
        <span class="small muted">ran {{ ago(b.sanoid.last, now) }} · next {{ ago(b.sanoid.next, now) }}</span>
      </div>
      <div class="job">
        <div><b>syncoid</b> <span class="muted small">tank → backup</span></div>
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
.zfs { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
.job { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; }
.job > .small { grid-column: 1 / -1; }
.snaps { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; }
.snaps .dot { width: 6px; height: 6px; box-shadow: none; margin-right: 2px; }
</style>
