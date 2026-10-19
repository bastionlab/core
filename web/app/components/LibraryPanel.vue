<script setup lang="ts">
const props = defineProps<{ library: any, sizes: any }>()
const l = computed(() => props.library ?? {})
const plural = (n: number | undefined, one: string, many = one + 's') => `${n ?? 0} ${n === 1 ? one : many}`
const cards = computed(() => [
  { icon: '🎞️', name: 'Movies', have: l.value.movies?.have, of: l.value.movies?.total, unit: 'films',
    size: l.value.movies?.size, note: l.value.movies?.total - l.value.movies?.have > 0 ? `${l.value.movies.total - l.value.movies.have} still wanted` : 'all downloaded', app: 'Radarr' },
  { icon: '📺', name: 'Series', have: l.value.series?.episodes, of: null, unit: `episodes in ${plural(l.value.series?.total, 'show')}`,
    size: l.value.series?.size, note: l.value.series?.missing ? `${l.value.series.missing} episodes missing` : 'nothing missing', app: 'Sonarr' },
  { icon: '🌸', name: 'Anime', have: l.value.anime?.episodes, of: null, unit: `episodes in ${plural(l.value.anime?.total, 'show')}`,
    size: l.value.anime?.size, note: l.value.anime?.missing ? `${l.value.anime.missing} episodes missing` : 'nothing missing', app: 'Sonarr' },
  { icon: '🎧', name: 'Audiobooks', have: l.value.books?.total, of: null, unit: 'books',
    size: props.sizes?.dirs?.hoerbuecher, note: l.value.books?.wanted ? `${l.value.books.wanted} wanted` : 'nothing wanted', app: 'LazyLibrarian' },
])
/** downloads/ is almost entirely hardlinks of the library dirs, so it is not a slice of its own —
 *  showing it next to anime/filme/serien reads as double the disk that is actually in use. */
const all = computed(() => Object.entries(props.sizes?.dirs ?? {}).map(([name, size]) => ({ name, size: size as number })))
const dirs = computed(() => all.value.filter(d => d.name !== 'downloads').sort((a, b) => b.size - a.size))
const colors = ['var(--accent)', '#b36bdb', '#2fa8a0', '#d9822b', '#c94f7c', '#6b8e23']
const libraries = computed(() => dirs.value.reduce((s, d) => s + d.size, 0))
const downloads = computed(() => all.value.find(d => d.name === 'downloads')?.size ?? 0)
const apparent = computed(() => props.sizes?.apparent ?? 0)
const used = computed(() => props.sizes?.used ?? 0)
/** what the downloads dir costs beyond the library copies it is hardlinked to */
const unique = computed(() => Math.max(0, used.value - libraries.value))
const saved = computed(() => Math.max(0, apparent.value - used.value))
</script>

<template>
  <Panel id="library" title="Library" sub="what you actually have">
    <div class="cards">
      <div v-for="c in cards" :key="c.name" class="card">
        <span class="icon">{{ c.icon }}</span>
        <div class="body">
          <div class="n">
            <b>{{ c.have ?? '–' }}</b><span v-if="c.of" class="muted">/{{ c.of }}</span>
            <span class="muted small">&nbsp;{{ c.unit }}</span>
          </div>
          <div class="small muted">{{ bytes(c.size) }} · {{ c.app }}</div>
          <div v-if="c.note" class="small faint">{{ c.note }}</div>
        </div>
      </div>
    </div>

    <h3>Disk <span class="muted small">tank/medien · {{ bytes(used) }} used</span></h3>
    <div class="bar">
      <span v-for="(d, i) in dirs" :key="d.name" :style="{ width: pct(d.size, libraries) + '%', background: colors[i % colors.length] }" :title="`${d.name}: ${bytes(d.size)}`" />
    </div>
    <div class="legend">
      <span v-for="(d, i) in dirs" :key="d.name" class="small">
        <i :style="{ background: colors[i % colors.length] }" />{{ d.name }} <span class="muted">{{ bytes(d.size) }}</span>
      </span>
    </div>
    <div class="faint small foot">
      {{ bytes(libraries) }} of library (all of it above, anime included), plus {{ bytes(unique) }} of downloads that are not yet
      hardlinked in — <b>{{ bytes(used) }}</b> on disk in total. The downloads dir looks like {{ bytes(downloads) }} of files but is the
      same bytes as the library copies, which is why {{ bytes(apparent) }} of files fit in {{ bytes(used) }} ({{ bytes(saved) }} saved).
      {{ bytes(sizes?.avail) }} free.
    </div>
  </Panel>
</template>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.card { display: flex; gap: 10px; background: var(--panel-2); border-radius: 9px; padding: 10px 12px; }
.icon { font-size: 20px; }
.body { min-width: 0; }
.n b { font-size: 17px; }
h3 { font-size: 13px; font-weight: 600; margin: 18px 0 8px; }
.bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--track); gap: 2px; }
.bar span { min-width: 3px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; }
.legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
.foot { margin-top: 12px; }
</style>
