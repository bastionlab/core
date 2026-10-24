<script setup lang="ts">
useHead({ title: 'Deals · pve' })

const shipping = ref<'all' | 'pickup' | 'ship'>('all')
const show = ref<'passed' | 'liked' | 'rejected'>('passed')
const { selected, d, error, pending, load, searches, st, counts, feed, tabs, verdict, isBusy, onChanged } = useHunter('/api/deals', 20000,
  sel => ({ search: sel ?? undefined, shipping: shipping.value === 'all' ? undefined : shipping.value, show: show.value, limit: 120 }),
  [shipping, show])

const SHIP = [
  { v: 'all' as const, label: 'All' },
  { v: 'pickup' as const, label: '🚗 Pickup' },
  { v: 'ship' as const, label: '📦 Shipping' },
]
// counts come from the server under the exact filters in force, so a tab's number always equals the cards it shows.
// Aussortiert = AI-rejected, reserved by the seller, or 👎; a 👍 stays in Passend too
const VIEWS = computed(() => [
  { v: 'passed', label: 'Matches', n: counts.value.passed },
  { v: 'liked', label: 'Saved', n: counts.value.liked },
  { v: 'rejected', label: 'Rejected', n: counts.value.rejected },
] as const)
</script>

<template>
  <div>
    <div v-if="!d && pending" class="muted pad">Loading listings…</div>
    <div v-else-if="error && !d" class="bad pad">
      The deals API in CT 107 is unreachable: {{ errText(error) }}
    </div>

    <template v-if="d">
      <!-- the poller writes every 8s; anything older than two minutes means it is not running -->
      <HunterStrip :st="st" :max-age="120" :pending="pending" @reload="load">
        <span class="muted"><b>{{ st.seen_24h }}</b> new 24h</span>
        <span class="muted" title="rejected by the AI"><b>{{ st.filtered ?? 0 }}</b> rejected</span>
        <span v-if="st.queued" class="muted"><b>{{ st.queued }}</b> → Discord</span>
      </HunterStrip>

      <DealSearches :searches="searches" @changed="onChanged" />

      <HunterTabs v-model:show="show" v-model:selected="selected" title="Listings" :views="VIEWS" :tabs="tabs()">
        <div class="seg">
          <button v-for="o in SHIP" :key="o.v" :class="{ on: shipping === o.v }" @click="shipping = o.v">{{ o.label }}</button>
        </div>
      </HunterTabs>

      <div v-if="!feed.length" class="muted pad">
        <template v-if="show === 'liked'">Nothing saved yet · 👍 a listing to keep it here.</template>
        <template v-else-if="show === 'passed' && counts.rejected">No matches yet · {{ counts.rejected }} rejected.</template>
        <template v-else-if="shipping !== 'all'">Nothing {{ shipping === 'pickup' ? 'for pickup' : 'with shipping' }}.</template>
        <template v-else>Nothing yet.</template>
      </div>
      <div v-else class="cards">
        <DealCard
          v-for="i in feed" :key="i.search_id + ':' + i.source_id" :item="i"
          :busy="isBusy(i)" @verdict="verdict(i, $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 48px 0; text-align: center; }
.seg { margin-left: auto; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 12px; margin-bottom: 16px; }
@media (max-width: 560px) { .seg { margin-left: 0; } .cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; } }
</style>
