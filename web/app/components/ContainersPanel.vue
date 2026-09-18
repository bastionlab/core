<script setup lang="ts">
defineProps<{ cts: any[], updates: any }>()
</script>

<template>
  <Panel id="containers" title="Containers">
    <div class="scroll-x">
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>CPU</th><th>Memory</th><th>Disk</th><th class="num">Uptime</th><th class="num">Updates</th></tr>
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
              <span v-if="updates?.cts?.[c.vmid]" :class="updates.cts[c.vmid].count ? 'warn' : 'faint'" :title="updates.cts[c.vmid].packages.join(', ')">
                {{ updates.cts[c.vmid].count }}
              </span>
              <span v-else class="faint">–</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Panel>
</template>

<style scoped>
table { min-width: 680px; }
.name { display: flex; align-items: center; gap: 8px; }
.w { width: 16%; }
.mini { height: 4px; background: var(--track); border-radius: 2px; overflow: hidden; margin-bottom: 3px; max-width: 140px; }
.mini i { display: block; height: 100%; background: var(--accent); }
.mini i.warn { background: var(--warn); } .mini i.bad { background: var(--bad); }
</style>
