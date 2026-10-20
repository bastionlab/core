<script setup lang="ts">
const props = defineProps<{ pools: any[], datasets: any[], smart: any[], now: number }>()
const diskTone = (d: any) => (d.warn?.length || d.passed === false ? 'bad' : d.passed ? 'ok' : '')
const scrubTone = (p: any) => (!p.scrubbed || props.now - p.scrubbed > 35 * 86400 ? 'warn' : '')
const leaves = computed(() => {
  const names = props.datasets.map(d => d.name)
  return props.datasets
    .filter(d => d.name !== 'tank' && !names.some(n => n.startsWith(d.name + '/')))
    .sort((a, b) => b.used - a.used)
})
const total = computed(() => leaves.value.reduce((s, d) => s + d.used, 0))
/** "scrub repaired 0B in 01:55:00 with 0 errors on Sun Oct 11 02:19:01 2026" → "scrub clean · 11.10." */
function scrub(scan?: string) {
  const m = scan?.match(/with (\d+) errors on (.+)$/)
  if (!m) return scan ?? 'never scrubbed'
  const d = new Date(m[2]!)
  return `scrub ${m[1] === '0' ? 'clean' : `${m[1]} errors`} · ${isNaN(+d) ? m[2] : d.toLocaleDateString('de-DE')}`
}
const colors = ['var(--accent)', '#b36bdb', '#2fa8a0', '#d9822b', '#c94f7c', '#6b8e23', '#8a7f72']
</script>

<template>
  <Panel id="storage" title="Storage" fold="phone">
    <Meter v-for="p in pools" :key="p.name" :label="p.name" :value="pct(p.alloc, p.size)" :detail="`${bytes(p.alloc)} / ${bytes(p.size)}`" :warn="80" />

    <div class="split">
      <div class="bar">
        <span v-for="(d, i) in leaves" :key="d.name" :style="{ width: pct(d.used, total) + '%', background: colors[i % colors.length] }" :title="d.name" />
      </div>
      <div class="legend">
        <span v-for="(d, i) in leaves" :key="d.name" class="small">
          <i :style="{ background: colors[i % colors.length] }" />{{ d.name.replace('tank/', '').replace('medien/', '') }}
          <span class="muted">{{ bytes(d.used) }}</span>
        </span>
      </div>
    </div>

    <div class="disks">
      <span
        v-for="d in smart" :key="d.dev" class="pill" :class="diskTone(d) === 'bad' ? 'bad' : ''"
        :title="[`${d.model} · ${d.hours ?? '?'}h powered on`, d.realloc != null ? `reallocated ${d.realloc} · pending ${d.pending} · uncorrectable ${d.uncorrectable} · CRC ${d.crc}` : '', d.spare != null ? `spare ${d.spare}% · media errors ${d.mediaErrors}` : '', ...(d.warn ?? [])].filter(Boolean).join('\n')"
      >
        <span class="dot" :class="diskTone(d)" /> {{ d.dev }} {{ bytes(d.size, 0) }}<template v-if="d.temp"> · {{ d.temp }}°C</template><template v-if="d.wear != null"> · {{ d.wear }}% worn</template>
      </span>
    </div>
    <div v-for="d in smart.filter(d => d.warn?.length)" :key="d.dev" class="bad small">⚠ {{ d.dev }}: {{ d.warn.join(', ') }}</div>
    <div class="faint small scan">
      <span v-for="p in pools" :key="p.name" :title="p.scan" :class="scrubTone(p)">{{ p.name }}: {{ scrub(p.scan) }}<template v-if="p.scrubbed"> ({{ ago(p.scrubbed, now) }})</template></span>
    </div>
  </Panel>
</template>

<style scoped>
.split { margin-top: 16px; }
.bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--track); gap: 2px; }
.bar span { min-width: 3px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; }
.legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
.disks { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.scan { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 2px 14px; }
</style>
