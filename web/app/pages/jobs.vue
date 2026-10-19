<script setup lang="ts">
useHead({ title: 'Jobs · pve' })

const selected = ref<number | null>(null)
const show = ref<'passed' | 'rejected' | 'pending' | 'applied'>('passed')

// filtered in CT 107, not here: one busy search must not crowd another out of the shared row limit
const d = ref<any>(null)
const error = ref<any>(null)
const pending = ref(false)

async function load() {
  pending.value = true
  try {
    d.value = await $fetch('/api/jobs', { query: { search: selected.value ?? undefined, show: show.value, limit: 200 } })
    error.value = null
  } catch (e: any) { error.value = e } finally { pending.value = false }
}
usePoll(load, 30000)
watch([selected, show], load)

const searches = computed(() => d.value?.searches ?? [])
const st = computed(() => d.value?.status)
const counts = computed(() => d.value?.counts ?? { per_search: {}, total: 0 })
const feed = computed(() => d.value?.feed ?? [])
const tabs = computed(() => [
  { id: null as number | null, name: 'Alle', hits: counts.value.total, enabled: true },
  ...searches.value.map((s: any) => ({ id: s.id, name: s.name, hits: counts.value.per_search?.[String(s.id)] ?? 0, enabled: !!s.enabled })),
])
const VIEWS = computed(() => [
  { v: 'passed', label: 'Passend', n: counts.value.passed },
  { v: 'applied', label: 'Gemerkt & beworben', n: counts.value.applied },
  { v: 'pending', label: 'wird gelesen', n: counts.value.pending },
  { v: 'rejected', label: 'Aussortiert', n: counts.value.rejected },
] as const)
// searches poll every 2 h; a loop tick is 2 min. Nothing for 3 h means it is stuck.
const pollerOk = computed(() => st.value?.last_poll && Date.now() / 1000 - st.value.last_poll < 3 * 3600)
const labels = computed(() => Object.fromEntries((st.value?.sources ?? []).map((s: any) => [s.id, s.label])))
const perSource = computed(() => Object.entries(st.value?.per_source ?? {}).sort((a: any, b: any) => b[1] - a[1])
  .map(([k, v]) => `${v} ${labels.value[k] ?? k}`).join(' · '))

const busyItem = ref('')
async function send(item: any, body: Record<string, any>, undo: () => void) {
  busyItem.value = item.source + item.source_id
  try {
    await $fetch('/api/jobs/action', { method: 'POST', body: { searchId: item.search_id, source: item.source, sourceId: item.source_id, ...body } })
    load()
  } catch { undo() } finally { busyItem.value = '' }
}
function verdict(item: any, v: 'up' | 'down' | null) {
  const before = item.verdict
  item.verdict = v
  send(item, { action: 'feedback', verdict: v }, () => { item.verdict = before })
}
function applied(item: any, v: boolean) {
  const before = item.applied_at
  item.applied_at = v ? Date.now() / 1000 : null
  send(item, { action: 'applied', applied: v }, () => { item.applied_at = before })
}

function onChanged() {
  if (selected.value !== null && !searches.value.some((s: any) => s.id === selected.value)) selected.value = null
  load()
}
</script>

<template>
  <div>
    <div v-if="!d && pending" class="muted pad">Lade Jobs…</div>
    <div v-else-if="error && !d" class="bad pad">
      Die Job-API in CT 107 ist nicht erreichbar: {{ error.statusMessage || error.message }}
    </div>

    <template v-if="d">
      <div class="strip small">
        <span class="dot" :class="!st.last_poll ? '' : pollerOk ? 'ok' : 'bad'" />
        <span :class="!st.last_poll || pollerOk ? 'muted' : 'bad'">
          {{ !st.searches ? 'keine Suche' : !st.last_poll ? 'erster Lauf…' : pollerOk ? `sucht · ${ago(st.last_poll)}` : `steht · ${ago(st.last_poll)}` }}
        </span>
        <span class="muted"><b>{{ st.seen_24h }}</b> neu 24h</span>
        <span v-if="st.pending" class="muted"><b>{{ st.pending }}</b> werden gelesen</span>
        <span v-if="perSource" class="faint src">{{ perSource }}</span>
        <button class="btn ghost ref" :disabled="pending" title="neu laden" @click="load">↻</button>
      </div>

      <JobCv @changed="load" />
      <JobSearches class="srch" :searches="searches" :sources="st.sources ?? []" :has-cv="st.cv" @changed="onChanged" />

      <h2 class="sec">
        Stellen
        <span class="views">
          <button v-for="v in VIEWS" :key="v.v" class="vw" :class="{ on: show === v.v }" @click="show = v.v">
            {{ v.label }} <span class="n">{{ v.n ?? 0 }}</span>
          </button>
        </span>
      </h2>

      <div v-if="tabs.length > 2" class="tabs">
        <button
          v-for="t in tabs" :key="t.id ?? 'all'" class="tab"
          :class="{ on: selected === t.id, off: !t.enabled }"
          @click="selected = t.id"
        >{{ t.name }} <span class="n">{{ t.hits }}</span></button>
      </div>

      <div v-if="!feed.length" class="muted pad">
        <template v-if="!searches.length">Lade einen Lebenslauf hoch und leg eine Suche an.</template>
        <template v-else-if="show === 'passed' && counts.pending">Die KI liest gerade {{ counts.pending }} Stellen…</template>
        <template v-else-if="show === 'passed' && counts.rejected">Noch nichts Passendes · {{ counts.rejected }} aussortiert.</template>
        <template v-else>Nichts hier.</template>
      </div>
      <div v-else class="list">
        <JobPosting
          v-for="i in feed" :key="i.search_id + ':' + i.source + ':' + i.source_id" :item="i"
          :busy="busyItem === i.source + i.source_id" @verdict="verdict(i, $event)" @applied="applied(i, $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 48px 0; text-align: center; }
.strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 2px 12px; }
.strip b { color: var(--text); font-weight: 600; }
.strip .ref { margin-left: auto; padding: 2px 8px; }
.srch { margin-top: 14px; }
.sec { flex-wrap: wrap; }
.views { margin-left: auto; display: flex; flex-wrap: wrap; gap: 2px; font-weight: 400; }
.vw { padding: 3px 9px; border-radius: 6px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.vw.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.vw .n, .tab .n { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.tab:hover { color: var(--text); }
.tab.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.tab.off { opacity: .55; }
.list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
@media (max-width: 560px) { .src { display: none; } .views { margin-left: 0; } }
</style>
