<script setup lang="ts">
useHead({ title: 'Deals · pve' })

const selected = ref<number | null>(null)
const shipping = ref<'all' | 'pickup' | 'ship'>('all')
const hideDown = ref(true)
const showRejected = ref(false)

// The feed is filtered in CT 107, not in the browser: with several searches a
// shared row limit would let a busy search crowd a quiet one out of its own tab.
const d = ref<any>(null)
const error = ref<any>(null)
const pending = ref(false)

async function load() {
  pending.value = true
  try {
    d.value = await $fetch('/api/deals', {
      query: {
        search: selected.value ?? undefined,
        shipping: shipping.value === 'all' ? undefined : shipping.value,
        show: showRejected.value ? 'all' : 'passed',
        hideDown: hideDown.value,
        limit: 120,
      },
    })
    error.value = null
  } catch (e: any) { error.value = e } finally { pending.value = false }
}
usePoll(load, 20000)
watch([selected, shipping, showRejected, hideDown], load)

const searches = computed(() => d.value?.searches ?? [])
const st = computed(() => d.value?.status)
const busyItem = ref('')

const SHIP = [
  { v: 'all' as const, label: 'Alle' },
  { v: 'pickup' as const, label: '🚗 Abholen' },
  { v: 'ship' as const, label: '📦 Versand' },
]

// counts come from the server under the exact filters in force, so a tab's
// number always equals the number of cards clicking it produces
const counts = computed(() => d.value?.counts ?? { per_search: {}, total: 0 })
const tabs = computed(() => [
  { id: null as number | null, name: 'All', hits: counts.value.total, enabled: true },
  ...searches.value.map((s: any) => ({
    id: s.id,
    name: s.name,
    hits: counts.value.per_search?.[String(s.id)] ?? 0,
    enabled: !!s.enabled,
  })),
])

const feed = computed(() => d.value?.feed ?? [])
const hidden = computed(() => (hideDown.value ? counts.value.thumbed_down ?? 0 : 0))

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
          <Stat label="Von KI aussortiert" :value="st.filtered ?? 0" />
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
        <label class="small muted tgl"><input v-model="showRejected" type="checkbox"> Aussortierte zeigen</label>
        <label class="small muted tgl2"><input v-model="hideDown" type="checkbox"> hide 👎</label>
      </h2>

      <div class="tabs">
        <button
          v-for="t in tabs" :key="t.id ?? 'all'" class="tab"
          :class="{ on: selected === t.id, off: !t.enabled }"
          @click="selected = t.id"
        >{{ t.name }} <span class="n">{{ t.hits }}</span></button>

        <div class="seg">
          <button v-for="o in SHIP" :key="o.v" :class="{ on: shipping === o.v }" @click="shipping = o.v">{{ o.label }}</button>
        </div>
      </div>

      <div v-if="!feed.length" class="muted pad">
        <template v-if="st.filtered && !showRejected">
          Nothing got past the AI filter here. Tick „Aussortierte zeigen“ to see what it dropped and why.
        </template>
        <template v-else-if="shipping !== 'all'">Nothing here that is {{ shipping === 'pickup' ? 'pickup-only' : 'shippable' }}.</template>
        <template v-else-if="selected !== null">Nothing matched this search yet.</template>
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
.tgl2 { text-transform: none; letter-spacing: 0; font-weight: 400; display: flex; align-items: center; gap: 5px; cursor: pointer; }
.tgl { margin-left: auto; text-transform: none; letter-spacing: 0; font-weight: 400; display: flex; align-items: center; gap: 5px; cursor: pointer; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.q { margin-top: 8px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.tab:hover { color: var(--text); }
.tab.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.tab.off { opacity: .55; }
.tab .n { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.seg { margin-left: auto; display: flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; background: var(--panel-2); }
.seg button { padding: 4px 12px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.seg button:hover { color: var(--text); }
.seg button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 14px; margin-bottom: 16px; }
@media (max-width: 560px) { .cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; } }
</style>
