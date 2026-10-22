<script setup lang="ts">
useHead({ title: 'Deals · pve' })

const shipping = ref<'all' | 'pickup' | 'ship'>('all')
const show = ref<'passed' | 'liked' | 'rejected'>('passed')
const { selected, d, error, pending, load, searches, st, counts, feed, tabs, verdict, isBusy, onChanged } = useHunter('/api/deals', 20000,
  sel => ({ search: sel ?? undefined, shipping: shipping.value === 'all' ? undefined : shipping.value, show: show.value, limit: 120 }),
  [shipping, show])

const SHIP = [
  { v: 'all' as const, label: 'Alle' },
  { v: 'pickup' as const, label: '🚗 Abholen' },
  { v: 'ship' as const, label: '📦 Versand' },
]
// counts come from the server under the exact filters in force, so a tab's number always equals the cards it shows.
// Aussortiert = AI-rejected, reserved by the seller, or 👎; a 👍 stays in Passend too
const VIEWS = computed(() => [
  { v: 'passed', label: 'Passend', n: counts.value.passed },
  { v: 'liked', label: 'Gemerkt', n: counts.value.liked },
  { v: 'rejected', label: 'Aussortiert', n: counts.value.rejected },
] as const)
</script>

<template>
  <div>
    <div v-if="!d && pending" class="muted pad">Lade Angebote…</div>
    <div v-else-if="error && !d" class="bad pad">
      Die Deals-API in CT 107 ist nicht erreichbar: {{ errText(error) }}
    </div>

    <template v-if="d">
      <!-- the poller writes every 8s; anything older than two minutes means it is not running -->
      <HunterStrip :st="st" :max-age="120" :pending="pending" @reload="load">
        <span class="muted"><b>{{ st.seen_24h }}</b> neu 24h</span>
        <span class="muted" title="von der KI aussortiert"><b>{{ st.filtered ?? 0 }}</b> aussortiert</span>
        <span v-if="st.queued" class="muted"><b>{{ st.queued }}</b> → Discord</span>
      </HunterStrip>

      <DealSearches :searches="searches" @changed="onChanged" />

      <HunterTabs v-model:show="show" v-model:selected="selected" title="Angebote" :views="VIEWS" :tabs="tabs()">
        <div class="seg">
          <button v-for="o in SHIP" :key="o.v" :class="{ on: shipping === o.v }" @click="shipping = o.v">{{ o.label }}</button>
        </div>
      </HunterTabs>

      <div v-if="!feed.length" class="muted pad">
        <template v-if="show === 'liked'">Noch nichts gemerkt · 👍 auf einem Angebot merkt es hier.</template>
        <template v-else-if="show === 'passed' && counts.rejected">Noch nichts Passendes · {{ counts.rejected }} aussortiert.</template>
        <template v-else-if="shipping !== 'all'">Nichts {{ shipping === 'pickup' ? 'zum Abholen' : 'mit Versand' }}.</template>
        <template v-else>Noch nichts.</template>
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
.seg { margin-left: auto; display: flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; background: var(--panel-2); }
.seg button { padding: 5px 12px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.seg button:hover { color: var(--text); }
.seg button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 12px; margin-bottom: 16px; }
@media (max-width: 560px) { .seg { margin-left: 0; } .cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; } }
</style>
