<script setup lang="ts">
const props = defineProps<{ library: any, sizes: any }>()
const l = computed(() => props.library ?? {})
const cards = computed(() => [
  { icon: '🎞️', name: 'Films', have: l.value.movies?.have, of: l.value.movies?.total, unit: 'films', size: l.value.movies?.size,
    note: l.value.movies?.total - l.value.movies?.have > 0 ? `${l.value.movies.total - l.value.movies.have} wanted` : '', shows: null },
  { icon: '📺', name: 'Series', have: l.value.series?.episodes, unit: 'eps', shows: l.value.series?.total, size: l.value.series?.size,
    note: l.value.series?.missing ? `${l.value.series.missing} missing` : '' },
  { icon: '🌸', name: 'Anime', have: l.value.anime?.episodes, unit: 'eps', shows: l.value.anime?.total, size: l.value.anime?.size,
    note: l.value.anime?.missing ? `${l.value.anime.missing} missing` : '' },
  { icon: '🎧', name: 'Audiobooks', have: l.value.books?.total, unit: 'books', size: props.sizes?.dirs?.hoerbuecher,
    note: l.value.books?.wanted ? `${l.value.books.wanted} wanted` : '', shows: null },
])
/** downloads/ is almost entirely hardlinks of the library dirs, so it is not a slice of its own —
 *  showing it next to anime/filme/serien reads as double the disk that is actually in use. */
const all = computed(() => Object.entries(props.sizes?.dirs ?? {}).map(([name, size]) => ({ name, size: size as number })))
const dirs = computed(() => all.value.filter(d => d.name !== 'downloads').sort((a, b) => b.size - a.size))
const colors = ['var(--accent)', '#b98cf0', '#3cc2b4', '#e89a4a', '#e0709c', '#8fb34a']
const libraries = computed(() => dirs.value.reduce((s, d) => s + d.size, 0))
const downloads = computed(() => all.value.find(d => d.name === 'downloads')?.size ?? 0)
const apparent = computed(() => props.sizes?.apparent ?? 0)
const used = computed(() => props.sizes?.used ?? 0)
/** what the downloads dir costs beyond the library copies it is hardlinked to */
const unique = computed(() => Math.max(0, used.value - libraries.value))
const saved = computed(() => Math.max(0, apparent.value - used.value))
const explain = computed(() => `${bytes(libraries.value)} library + ${bytes(unique.value)} downloads not yet hardlinked. `
  + `downloads/ looks like ${bytes(downloads.value)} but shares bytes with the library: ${bytes(apparent.value)} of files in ${bytes(used.value)} (${bytes(saved.value)} saved).`)
</script>

<template>
  <Panel id="library" title="Library" :sub="`${bytes(used)} used · ${bytes(sizes?.avail)} free`">
    <div class="cards">
      <div v-for="c in cards" :key="c.name" class="card" :title="c.name">
        <span class="icon">{{ c.icon }}</span>
        <div class="body">
          <div class="n"><b>{{ c.have ?? '–' }}</b><span v-if="c.of" class="muted">/{{ c.of }}</span> <span class="muted small">{{ c.unit }}</span></div>
          <div class="small faint">{{ bytes(c.size) }}<template v-if="c.shows != null"> · {{ c.shows }} shows</template><span v-if="c.note" class="warn"> · {{ c.note }}</span></div>
        </div>
      </div>
    </div>

    <div class="bar" :title="explain">
      <span v-for="(d, i) in dirs" :key="d.name" :style="{ width: pct(d.size, libraries) + '%', background: colors[i % colors.length] }" :title="`${d.name}: ${bytes(d.size)}`" />
    </div>
    <div class="legend">
      <span v-for="(d, i) in dirs" :key="d.name" class="small">
        <i :style="{ background: colors[i % colors.length] }" />{{ d.name.replace(/^\./, '') }} <span class="faint">{{ bytes(d.size) }}</span>
      </span>
    </div>
  </Panel>
</template>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.card { display: flex; align-items: center; gap: 12px; background: var(--panel-2); border-radius: var(--radius-sm); padding: 10px 12px; min-width: 0; }
.icon { font-size: 20px; flex: none; }
.body { min-width: 0; }
.body > div:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.n b { font-size: 17px; }
.bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--track); gap: 2px; margin-top: 18px; cursor: help; }
.bar span { min-width: 3px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 9px; color: var(--muted); }
.legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
@media (max-width: 400px) { .card { padding: 9px 10px; gap: 9px; } .icon { font-size: 17px; } }
</style>
