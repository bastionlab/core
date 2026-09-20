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
const dirs = computed(() => Object.entries(props.sizes?.dirs ?? {}).map(([name, size]) => ({ name, size: size as number })).sort((a, b) => b.size - a.size))
const colors = ['var(--accent)', '#b36bdb', '#2fa8a0', '#d9822b', '#c94f7c', '#6b8e23']
const apparent = computed(() => props.sizes?.apparent ?? 0)
const saved = computed(() => Math.max(0, apparent.value - (props.sizes?.used ?? 0)))
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

    <h3>Disk <span class="muted small">tank/medien</span></h3>
    <div class="bar">
      <span v-for="(d, i) in dirs" :key="d.name" :style="{ width: pct(d.size, apparent) + '%', background: colors[i % colors.length] }" :title="`${d.name}: ${bytes(d.size)}`" />
    </div>
    <div class="legend">
      <span v-for="(d, i) in dirs" :key="d.name" class="small">
        <i :style="{ background: colors[i % colors.length] }" />{{ d.name }} <span class="muted">{{ bytes(d.size) }}</span>
      </span>
    </div>
    <div class="faint small foot">
      {{ bytes(apparent) }} of files, but only <b>{{ bytes(sizes?.used) }}</b> on disk — finished downloads are hardlinked into the library,
      so seeding costs nothing ({{ bytes(saved) }} saved). {{ bytes(sizes?.avail) }} free.
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
