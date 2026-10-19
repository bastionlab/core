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
      <div class="strip small">
        <span class="dot" :class="!st.last_poll ? '' : pollerOk ? 'ok' : 'bad'" />
        <span :class="!st.last_poll || pollerOk ? 'muted' : 'bad'">
          <!-- the first cycle walks all of inberlinwohnen before any search counts as polled -->
          {{ !st.searches ? 'keine Suche' : !st.last_poll ? 'erster Lauf…' : pollerOk ? `sucht · ${ago(st.last_poll)}` : `steht · ${ago(st.last_poll)}` }}
        </span>
        <span class="muted"><b>{{ st.seen_24h }}</b> neu 24h</span>
        <span class="muted"><b>{{ st.read_by_ai }}</b> von KI gelesen</span>
        <span v-if="sources" class="faint src">{{ sources }}</span>
        <button class="btn ghost ref" :disabled="pending" title="neu laden" @click="load">↻</button>
      </div>
      <div v-for="e in st.errors" :key="e.name" class="small bad q">{{ e.name }}: {{ e.error }}</div>

      <FlatSearches :searches="searches" @changed="onChanged" />

      <h2 class="sec">
        Wohnungen
        <span class="muted small">{{ feed.length }}<template v-if="hidden"> · {{ hidden }} aussortiert</template></span>
        <label class="small muted tgl"><input v-model="showRejected" type="checkbox"> Aussortierte</label>
      </h2>

      <div v-if="tabs.length > 1" class="tabs">
        <button
          v-for="t in tabs" :key="t.id ?? 'all'" class="tab"
          :class="{ on: selected === t.id, off: !t.enabled }"
          @click="selected = t.id"
        >{{ t.name }} <span class="n">{{ t.hits }}</span></button>
      </div>

      <div v-if="!feed.length" class="muted pad">
        <template v-if="!searches.length">Noch keine Suche.</template>
        <template v-else-if="hidden && !showRejected">Alles aussortiert.</template>
        <template v-else>Noch nichts gefunden.</template>
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
.pad { padding: 48px 0; text-align: center; }
.strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 2px 12px; }
.strip b { color: var(--text); font-weight: 600; }
.strip .ref { margin-left: auto; padding: 2px 8px; }
.sec { flex-wrap: wrap; }
.tgl { margin-left: auto; font-weight: 400; display: flex; align-items: center; gap: 5px; cursor: pointer; }
.q { margin: -6px 2px 10px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.tab:hover { color: var(--text); }
.tab.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.tab.off { opacity: .55; }
.tab .n { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
@media (max-width: 560px) { .src { display: none; } }
</style>
