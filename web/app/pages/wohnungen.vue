<script setup lang="ts">
useHead({ title: 'Wohnungen · pve' })

const selected = ref<number | null>(null)
const showRejected = ref(false)

// filtered in CT 107, not here: one busy search must not crowd another out of the shared row limit
const d = ref<any>(null)
const error = ref<any>(null)
const pending = ref(false)

async function load() {
  pending.value = true
  try {
    d.value = await $fetch('/api/flats', {
      query: { search: selected.value ?? undefined, show: showRejected.value ? 'all' : 'passed', limit: 200 },
    })
    error.value = null
  } catch (e: any) { error.value = e } finally { pending.value = false }
}
usePoll(load, 30000)
watch([selected, showRejected], load)

const searches = computed(() => d.value?.searches ?? [])
const st = computed(() => d.value?.status)
const counts = computed(() => d.value?.counts ?? { per_search: {}, total: 0 })
const feed = computed(() => d.value?.feed ?? [])
const hidden = computed(() => counts.value.sorted_out ?? 0)
const tabs = computed(() => [
  { id: null as number | null, name: 'Alle', hits: counts.value.total, enabled: true },
  ...searches.value.map((s: any) => ({ id: s.id, name: s.name, hits: counts.value.per_search?.[String(s.id)] ?? 0, enabled: !!s.enabled })),
])
// a cycle is ~2.5 min plus the time it takes; three cycles without a poll means it is stuck
const pollerOk = computed(() => st.value?.last_poll && Date.now() / 1000 - st.value.last_poll < (st.value.cycle ?? 150) * 3 + 300)
const sources = computed(() => Object.entries(st.value?.per_source ?? {}).map(([k, v]) => `${v} ${k}`).join(' · '))

const busyItem = ref('')
async function verdict(item: any, v: 'up' | 'down' | null) {
  busyItem.value = item.source + item.source_id
  const before = item.verdict
  item.verdict = v
  try {
    await $fetch('/api/flats/action', {
      method: 'POST',
      body: { action: 'feedback', searchId: item.search_id, source: item.source, sourceId: item.source_id, verdict: v },
    })
  } catch { item.verdict = before } finally { busyItem.value = '' }
}

function onChanged() {
  if (selected.value !== null && !searches.value.some((s: any) => s.id === selected.value)) selected.value = null
  load()
}
</script>

<template>
  <div>
    <div v-if="!d && pending" class="muted pad">Lade Wohnungen…</div>
    <div v-else-if="error && !d" class="bad pad">
      Die Wohnungs-API in CT 107 ist nicht erreichbar: {{ error.statusMessage || error.message }}
    </div>

    <template v-if="d">
      <Panel title="Wohnungsjagd" :sub="!st.searches ? 'keine Suche' : !st.last_poll ? 'erster Lauf…' : pollerOk ? 'sucht' : 'Poller scheint zu stehen'">
        <template #actions>
          <button class="btn ghost" :disabled="pending" @click="load">↻</button>
        </template>
        <div class="stats">
          <Stat label="Suchen" :value="`${st.enabled}/${st.searches}`" />
          <Stat label="Neu 24h" :value="st.seen_24h" />
          <Stat label="Von KI gelesen" :value="st.read_by_ai" />
          <!-- the first cycle walks all of inberlinwohnen before any search counts as polled -->
          <Stat label="Letzter Lauf" :value="st.last_poll ? ago(st.last_poll) : st.searches ? 'läuft…' : 'nie'" :tone="!st.last_poll ? '' : pollerOk ? 'ok' : 'bad'" />
        </div>
        <div v-if="sources" class="small muted q">Online: {{ sources }}</div>
        <div v-for="e in st.errors" :key="e.name" class="small bad q">{{ e.name }}: {{ e.error }}</div>
      </Panel>

      <div class="grid">
        <FlatSearches :searches="searches" @changed="onChanged" />
      </div>

      <h2 class="sec">
        Wohnungen
        <span class="muted small">
          {{ feed.length }} Angebot{{ feed.length === 1 ? '' : 'e' }}
          <template v-if="hidden"> · {{ hidden }} aussortiert</template>
        </span>
        <label class="small muted tgl"><input v-model="showRejected" type="checkbox"> Aussortierte zeigen</label>
      </h2>

      <div class="tabs">
        <button
          v-for="t in tabs" :key="t.id ?? 'all'" class="tab"
          :class="{ on: selected === t.id, off: !t.enabled }"
          @click="selected = t.id"
        >{{ t.name }} <span class="n">{{ t.hits }}</span></button>
      </div>

      <div v-if="!feed.length" class="muted pad">
        <template v-if="!searches.length">Leg oben eine Suche an.</template>
        <template v-else-if="hidden && !showRejected">Alles hier ist aussortiert (Gesuch, Zwischenmiete, Betrugsverdacht, 👎). „Aussortierte zeigen“ blendet es ein.</template>
        <template v-else>Noch nichts gefunden. Neue Suchen brauchen ein paar Minuten für den ersten Lauf.</template>
      </div>
      <div v-else class="list">
        <FlatRow
          v-for="i in feed" :key="i.search_id + ':' + i.source + ':' + i.source_id" :item="i"
          :busy="busyItem === i.source + i.source_id" @verdict="verdict(i, $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.sec { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--muted); margin: 22px 0 10px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.sec .small { text-transform: none; letter-spacing: 0; font-weight: 400; }
.tgl { margin-left: auto; text-transform: none; letter-spacing: 0; font-weight: 400; display: flex; align-items: center; gap: 5px; cursor: pointer; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.q { margin-top: 8px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.tab:hover { color: var(--text); }
.tab.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.tab.off { opacity: .55; }
.tab .n { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
@media (max-width: 560px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
