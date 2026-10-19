<script setup lang="ts">
/**
 * Delete a series or film for good: the *arr entry with its files, and the torrents seeding it.
 * For a series it can instead delete only some seasons: those are unmonitored and their files go, while the
 * series stays in Sonarr and keeps fetching new episodes — e.g. keep only the running season.
 * Two confirmations, and the second button only arms after a moment — there is no trash for this.
 * Deliberately not an Ask-bar action: only a person picking a title here can start it.
 */
const emit = defineEmits<{ removed: [] }>()
const { jobs, run, dismiss } = useActions()

const { data: items, refresh: reload, pending: loading, error: loadError } = useFetch<any[]>('/api/media/items', { lazy: true, server: false, default: () => [] })

const kind = ref<'all' | 'series' | 'anime' | 'movie'>('all')
const query = ref('')
const LABEL: Record<string, string> = { series: 'Series', anime: 'Anime', movie: 'Film' }

const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (items.value ?? []).filter(i => (kind.value === 'all' || i.group === kind.value)
    && (!q || i.title.toLowerCase().includes(q) || String(i.year ?? '').includes(q)))
})
const counts = computed(() => {
  const c: Record<string, number> = { all: 0, series: 0, anime: 0, movie: 0 }
  for (const i of items.value ?? []) { c.all++; c[i.group]++ }
  return c
})

const picked = ref<any>(null)
const plan = ref<any>(null)
const planError = ref('')
const mode = ref<'whole' | 'seasons'>('whole')
const chosen = ref<number[]>([])
let planSeq = 0

/** seasons worth offering: the ones with files on disk */
const seasonsOnDisk = computed(() => (picked.value?.seasons ?? []).filter((s: any) => s.files > 0))
const latest = computed(() => Math.max(0, ...(picked.value?.seasons ?? []).map((s: any) => s.n)))
const sname = (n: number) => n === 0 ? 'Specials' : `S${n}`
const seasonList = (ns: number[]) => ns.map(sname).join(', ')
const step = ref<0 | 1 | 2>(0) // 0 picked, 1 first confirm shown, 2 second confirm armed
const showTorrents = ref(false)
let armTimer: any

async function loadPlan() {
  const i = picked.value
  if (!i) return
  cancel()
  plan.value = null
  planError.value = ''
  const seasons = mode.value === 'seasons' ? chosen.value : []
  if (mode.value === 'seasons' && !seasons.length) return
  const seq = ++planSeq
  try {
    const p = await $fetch('/api/media/plan', { query: { kind: i.kind, id: i.id, ...(seasons.length ? { seasons: seasons.join(',') } : {}) } })
    if (seq === planSeq) plan.value = p
  } catch (e: any) {
    if (seq === planSeq) planError.value = e?.data?.statusMessage || e?.statusMessage || e?.message || 'could not read it'
  }
}

function pick(i: any) {
  picked.value = i
  mode.value = 'whole'
  chosen.value = []
  loadPlan()
}

function setMode(m: 'whole' | 'seasons') {
  if (mode.value === m) return
  mode.value = m
  loadPlan()
}

function toggle(n: number) {
  chosen.value = chosen.value.includes(n) ? chosen.value.filter(x => x !== n) : [...chosen.value, n].sort((a, b) => a - b)
  loadPlan()
}

function allButLatest() {
  chosen.value = seasonsOnDisk.value.map((s: any) => s.n).filter((n: number) => n !== latest.value)
  loadPlan()
}

function confirmOnce() {
  step.value = 1
  clearTimeout(armTimer)
  armTimer = setTimeout(() => { if (step.value === 1) step.value = 2 }, 2000)
}

function cancel() {
  step.value = 0
  clearTimeout(armTimer)
}

async function remove() {
  if (step.value !== 2 || !plan.value) return
  const p = plan.value
  cancel()
  picked.value = null
  plan.value = null
  query.value = ''
  await run('media_remove', { kind: p.kind, id: p.id, ...(p.seasons ? { seasons: p.seasons } : {}) }, () => { reload(); emit('removed') })
}

const name = (p: any) => p.title + (p.year ? ` (${p.year})` : '')
const what = (p: any) => p.seasons ? `${seasonList(p.seasons)} of ${p.title}` : p.title
onBeforeUnmount(() => clearTimeout(armTimer))
</script>

<template>
  <Panel id="remove" title="Remove from the library" sub="files, torrents and Jellyfin in one go">
    <template #actions>
      <button class="btn ghost small" :disabled="loading" title="reload the list from Sonarr and Radarr" @click="reload()">↻</button>
    </template>

    <JobList :jobs="jobs" @dismiss="dismiss" />

    <div class="row">
      <select v-model="kind" class="in">
        <option value="all">All ({{ counts.all }})</option>
        <option value="series">Series ({{ counts.series }})</option>
        <option value="anime">Anime ({{ counts.anime }})</option>
        <option value="movie">Films ({{ counts.movie }})</option>
      </select>
      <input v-model="query" class="in grow" type="search" placeholder="Search by title or year…">
    </div>

    <div v-if="loadError" class="small bad hint">Could not read the library: {{ loadError.statusMessage || loadError.message }}</div>
    <div v-else-if="loading && !items?.length" class="small muted hint">Loading the library…</div>
    <div v-else class="list">
      <button
        v-for="i in matches" :key="`${i.kind}:${i.id}`" class="item"
        :class="{ on: picked && picked.kind === i.kind && picked.id === i.id }" @click="pick(i)"
      >
        <span class="t">{{ i.title }} <span v-if="i.year" class="muted">{{ i.year }}</span></span>
        <span class="pill">{{ LABEL[i.group] }}</span>
        <span class="small muted num">{{ i.files ? bytes(i.size) : 'no files' }}</span>
      </button>
      <div v-if="!matches.length" class="small muted empty">Nothing matches.</div>
    </div>

    <div v-if="picked" class="plan" :class="{ hot: step > 0 }">
      <div v-if="picked.kind === 'series' && seasonsOnDisk.length" class="scope">
        <div class="seg small">
          <button :class="{ on: mode === 'whole' }" @click="setMode('whole')">Whole series</button>
          <button :class="{ on: mode === 'seasons' }" @click="setMode('seasons')">Only some seasons</button>
        </div>
        <div v-if="mode === 'seasons'" class="seasons">
          <label v-for="s in seasonsOnDisk" :key="s.n" class="chip small" :class="{ on: chosen.includes(s.n) }">
            <input type="checkbox" :checked="chosen.includes(s.n)" @change="toggle(s.n)">
            {{ sname(s.n) }} <span class="muted">{{ s.files }} ep · {{ bytes(s.size) }}</span>
          </label>
          <button v-if="seasonsOnDisk.length > 1" class="btn ghost small" @click="allButLatest">all but {{ sname(latest) }}</button>
        </div>
        <div v-if="mode === 'seasons' && chosen.includes(latest)" class="small warn">
          {{ sname(latest) }} is the newest season — removing it unmonitors it too, so its new episodes stop coming.
        </div>
      </div>
      <div v-if="mode === 'seasons' && !chosen.length" class="small muted">Pick the seasons to delete.</div>
      <div v-else-if="planError" class="small bad">{{ planError }}</div>
      <div v-else-if="!plan" class="small muted">Working out what belongs to {{ picked.title }}…</div>
      <template v-else>
        <div class="head">
          <b>{{ name(plan) }}</b>
          <span class="pill">{{ LABEL[plan.group] }}</span>
          <span v-if="plan.seasons" class="pill">{{ seasonList(plan.seasons) }}</span>
        </div>
        <ul class="small facts">
          <li>
            <b>{{ plan.kind === 'series' ? `${plan.files} episode file(s)` : plan.files ? 'the film file' : 'no file on disk' }}</b>, {{ bytes(plan.size) }}
            <span class="muted mono">· {{ plan.path }}</span>
          </li>
          <li v-if="plan.torrents.length">
            <b>{{ plan.torrents.length }} torrent(s)</b> in qBittorrent with their data, {{ bytes(plan.torrentSize) }}
            <button class="btn ghost small" @click="showTorrents = !showTorrents">{{ showTorrents ? 'hide' : 'show' }}</button>
            <ul v-if="showTorrents" class="torrents muted">
              <li v-for="t in plan.torrents" :key="t.hash">{{ t.name }} <span class="faint">· {{ bytes(t.size) }}</span></li>
            </ul>
          </li>
          <li v-else class="muted">no torrents of it left in qBittorrent</li>
          <li v-if="plan.shared?.length" class="muted">{{ plan.shared.length }} torrent(s) also cover a season you keep — they stay seeding</li>
          <li v-if="plan.seasons" class="muted">
            Sonarr unmonitors {{ seasonList(plan.seasons) }} so they are not downloaded again; the series stays and keeps getting new episodes. Jellyfin drops the files on its own.
          </li>
          <li v-else class="muted">{{ plan.app === 'sonarr' ? 'Sonarr' : 'Radarr' }} stops tracking it and adds a list exclusion, so it is not downloaded again. Jellyfin drops it on its own.</li>
        </ul>

        <div class="row end">
          <template v-if="step === 0">
            <button class="btn ghost" @click="picked = null">Close</button>
            <button class="btn danger" @click="confirmOnce">Delete…</button>
          </template>
          <template v-else>
            <span class="small bad grow">This cannot be undone — there is no trash for media.</span>
            <button class="btn ghost" @click="cancel">Cancel</button>
            <button class="btn solid-bad" :disabled="step !== 2" @click="remove">
              {{ step === 2 ? `Yes, delete ${what(plan)}` : 'Wait…' }}
            </button>
          </template>
        </div>
      </template>
    </div>
  </Panel>
</template>

<style scoped>
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.row.end { justify-content: flex-end; margin-top: 12px; }
.in { background: var(--panel-2); border: 1px solid var(--line); border-radius: 7px; color: var(--text); font: inherit; font-size: 13px; padding: 6px 9px; }
.grow { flex: 1; min-width: 160px; }
.hint { margin-top: 10px; }
.list { margin-top: 10px; max-height: 264px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; }
.item { display: grid; grid-template-columns: minmax(0, 1fr) auto 64px; gap: 10px; align-items: center; width: 100%; padding: 7px 10px; background: none; border: 0; border-bottom: 1px solid var(--line); color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.item:last-child { border-bottom: 0; }
.item:hover { background: var(--panel-2); }
.item.on { background: var(--accent-soft); }
.item .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: 12px; text-align: center; }
.plan { margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); }
.plan.hot { border-color: var(--bad); background: var(--bad-soft); }
.head { display: flex; gap: 8px; align-items: center; }
.facts { margin: 8px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.torrents { margin: 4px 0 0; padding-left: 16px; max-height: 160px; overflow-y: auto; word-break: break-word; }
.scope { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.seg { display: inline-flex; align-self: flex-start; border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
.seg button { background: none; border: 0; color: var(--muted); font: inherit; padding: 5px 10px; cursor: pointer; }
.seg button.on { background: var(--accent-soft); color: var(--text); }
.seasons { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip { display: inline-flex; gap: 6px; align-items: center; padding: 4px 9px; border: 1px solid var(--line); border-radius: 999px; cursor: pointer; user-select: none; }
.chip.on { border-color: var(--bad); background: var(--bad-soft); }
.chip input { margin: 0; }
.warn { color: var(--warn); }
.mono { font-family: var(--mono); word-break: break-all; }
.btn.solid-bad { background: var(--bad); border-color: var(--bad); color: #fff; }
.btn.solid-bad:disabled { opacity: .45; }
</style>
