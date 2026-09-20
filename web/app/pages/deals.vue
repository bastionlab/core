<script setup lang="ts">
useHead({ title: 'Deals · pve' })

const selected = ref<number | null>(null)
const hideDown = ref(true)
const { data: d, error, pending, refresh } = useDeals()
usePoll(refresh, 20000)

const searches = computed(() => d.value?.searches ?? [])
const st = computed(() => d.value?.status)
const busyItem = ref('')

const feed = computed(() => {
  let list = d.value?.feed ?? []
  if (selected.value !== null) list = list.filter((i: any) => i.search_id === selected.value)
  if (hideDown.value) list = list.filter((i: any) => i.verdict !== 'down')
  return list
})

// the poller writes every 8s; anything older than two minutes means it is not running
const pollerOk = computed(() => st.value?.last_poll && Date.now() / 1000 - st.value.last_poll < 120)

async function verdict(item: any, v: 'up' | 'down' | null) {
  const key = item.source_id
  busyItem.value = key
  const before = item.verdict
  item.verdict = v                                   // optimistic; the poll would lag 20s otherwise
  try {
    await $fetch('/api/deals/action', {
      method: 'POST',
      body: { action: 'feedback', searchId: item.search_id, source: item.source, sourceId: item.source_id, verdict: v },
    })
  } catch { item.verdict = before } finally { busyItem.value = '' }
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
          <button class="btn ghost" :disabled="pending" @click="refresh">↻</button>
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
        <DealSearches :searches="searches" :selected="selected" @select="selected = $event" @changed="refresh" />
      </div>

      <h2 class="sec">
        Feed <span class="muted small">{{ feed.length }} listing{{ feed.length === 1 ? '' : 's' }}</span>
        <label class="small muted tgl"><input v-model="hideDown" type="checkbox"> hide 👎</label>
      </h2>

      <div v-if="!feed.length" class="muted pad">
        Nothing yet. A search only starts pushing from its second poll — the first one just seeds
        what is already online so you do not get 25 notifications at once.
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
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 14px; margin-bottom: 16px; }
@media (max-width: 560px) { .cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; } }
</style>
