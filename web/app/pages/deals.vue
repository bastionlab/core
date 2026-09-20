<script setup lang="ts">
useHead({ title: 'Deals · pve' })

const selected = ref<number | null>(null)
const hideDown = ref(true)

// The feed is filtered in CT 107, not in the browser: with several searches a
// shared row limit would let a busy search crowd a quiet one out of its own tab.
const d = ref<any>(null)
const error = ref<any>(null)
const pending = ref(false)

async function load() {
  pending.value = true
  try {
    d.value = await $fetch('/api/deals', { query: { search: selected.value ?? undefined, limit: 120 } })
    error.value = null
  } catch (e: any) { error.value = e } finally { pending.value = false }
}
usePoll(load, 20000)
watch(selected, load)

const searches = computed(() => d.value?.searches ?? [])
const st = computed(() => d.value?.status)
const busyItem = ref('')

const tabs = computed(() => [
  { id: null as number | null, name: 'All', hits: searches.value.reduce((n: number, s: any) => n + (s.hits ?? 0), 0), enabled: true },
  ...searches.value.map((s: any) => ({ id: s.id, name: s.name, hits: s.hits, enabled: !!s.enabled })),
])

const feed = computed(() => {
  const list = d.value?.feed ?? []
  return hideDown.value ? list.filter((i: any) => i.verdict !== 'down') : list
})
const hidden = computed(() => (d.value?.feed ?? []).length - feed.value.length)

// the poller writes every 8s; anything older than two minutes means it is not running
const pollerOk = computed(() => st.value?.last_poll && Date.now() / 1000 - st.value.last_poll < 120)

async function verdict(item: any, v: 'up' | 'down' | null) {
  busyItem.value = item.source_id
  const before = item.verdict
  item.verdict = v                                   // optimistic; the poll would lag 20s otherwise
  try {
    await $fetch('/api/deals/action', {
      method: 'POST',
      body: { action: 'feedback', searchId: item.search_id, source: item.source, sourceId: item.source_id, verdict: v },
    })
  } catch { item.verdict = before } finally { busyItem.value = '' }
}

function onChanged() {
  // a deleted search must not stay selected, or the feed asks for rows that cannot exist
  if (selected.value !== null && !searches.value.some((s: any) => s.id === selected.value)) selected.value = null
  load()
}
</script>

<template>
  <div>
    <div v-if="!d && pending" class="muted pad">Loading the feed…</div>
    <div v-else-if="error && !d" class="bad pad">
      Could not reach the deals API in CT 107: {{ error.statusMessage || error.message }}
    </div>

    <template v-if="d">
      <Panel title="Hunter" :sub="pollerOk ? 'polling' : 'poller looks stopped'">
        <template #actions>
          <button class="btn ghost" :disabled="pending" @click="load">↻</button>
        </template>
        <div class="stats">
          <Stat label="Searches" :value="`${st.enabled}/${st.searches}`" />
          <Stat label="Seen 24h" :value="st.seen_24h" />
          <Stat label="Matches" :value="st.matches" />
          <Stat label="Last poll" :value="st.last_poll ? ago(st.last_poll) : 'never'" :tone="pollerOk ? 'ok' : 'bad'" />
        </div>
        <div v-if="st.queued" class="small muted q">{{ st.queued }} waiting to be pushed to Telegram</div>
        <div v-for="e in st.errors" :key="e.name" class="small bad q">{{ e.name }}: {{ e.error }}</div>
      </Panel>

      <div class="grid">
        <DealSearches :searches="searches" @changed="onChanged" />
      </div>

      <h2 class="sec">
        Feed
        <span class="muted small">
          {{ feed.length }} listing{{ feed.length === 1 ? '' : 's' }}
          <template v-if="hidden"> · {{ hidden }} hidden</template>
        </span>
        <label class="small muted tgl"><input v-model="hideDown" type="checkbox"> hide 👎</label>
      </h2>

      <div class="tabs">
        <button
          v-for="t in tabs" :key="t.id ?? 'all'" class="tab"
          :class="{ on: selected === t.id, off: !t.enabled }"
          @click="selected = t.id"
        >{{ t.name }} <span class="n">{{ t.hits }}</span></button>
      </div>

      <div v-if="!feed.length" class="muted pad">
        <template v-if="selected !== null">Nothing matched this search yet.</template>
        <template v-else>
          Nothing yet. A search only starts pushing from its second poll — the first one just seeds
          what is already online so you do not get 25 notifications at once.
        </template>
      </div>
      <div v-else class="cards">
        <DealCard
          v-for="i in feed" :key="i.search_id + ':' + i.source_id" :item="i"
          :busy="busyItem === i.source_id" @verdict="verdict(i, $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.sec { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--muted); margin: 22px 0 10px; display: flex; gap: 10px; align-items: baseline; }
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
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 14px; margin-bottom: 16px; }
@media (max-width: 560px) { .cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; } }
</style>
