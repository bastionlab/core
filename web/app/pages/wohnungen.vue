<script setup lang="ts">
useHead({ title: 'Flats · pve' })

const show = ref<'passed' | 'liked' | 'rejected'>('passed')
const { selected, d, error, pending, load, searches, st, counts, tabs, verdict, isBusy, onChanged } = useHunter('/api/flats', 30000,
  sel => ({ search: sel ?? undefined, show: show.value === 'rejected' ? 'rejected' : 'passed', limit: 200 }), [show])

const liked = computed(() => d.value?.liked ?? [])
const likedLive = computed(() => liked.value.filter((i: any) => i.status !== 'gone').length)
// 👍 flats come as their own list, so Gemerkt filters and counts per search here
const feed = computed(() => show.value !== 'liked' ? d.value?.feed ?? []
  : liked.value.filter((i: any) => selected.value === null || i.search_id === selected.value))
const hits = (id: number | null) => show.value !== 'liked'
  ? (id === null ? counts.value.total : counts.value.per_search?.[String(id)] ?? 0)
  : liked.value.filter((i: any) => id === null || i.search_id === id).length
const VIEWS = computed(() => [
  { v: 'passed', label: 'Matches', n: counts.value.passed },
  { v: 'liked', label: 'Saved', n: liked.value.length },
  { v: 'rejected', label: 'Rejected', n: counts.value.rejected },
] as const)
// a cycle is ~2.5 min plus the time it takes; three cycles without a poll means it is stuck
const maxAge = computed(() => (st.value?.cycle ?? 150) * 3 + 300)
const sources = computed(() => Object.entries(st.value?.per_source ?? {}).map(([k, v]) => `${v} ${k}`).join(' · '))
</script>

<template>
  <div>
    <div v-if="!d && pending" class="muted pad">Loading flats…</div>
    <div v-else-if="error && !d" class="bad pad">
      The flats API in CT 107 is unreachable: {{ errText(error) }}
    </div>

    <template v-if="d">
      <!-- the first cycle walks all of inberlinwohnen before any search counts as polled -->
      <HunterStrip :st="st" :max-age="maxAge" :pending="pending" @reload="load">
        <span class="muted"><b>{{ st.seen_24h }}</b> new 24h</span>
        <span class="muted"><b>{{ st.read_by_ai }}</b> read by AI</span>
        <span v-if="sources" class="faint src">{{ sources }}</span>
      </HunterStrip>

      <FlatSearches :searches="searches" @changed="onChanged" />
      <FlatProfile class="prof" :search="selected" :searches="searches" />

      <HunterTabs v-model:show="show" v-model:selected="selected" title="Flats" :views="VIEWS" :tabs="tabs(hits)">
        <template #note>
          <div v-if="show === 'liked' && liked.length > likedLive" class="small muted q">
            {{ likedLive }} online · {{ liked.length - likedLive }} offline
          </div>
        </template>
      </HunterTabs>

      <div v-if="!feed.length" class="muted pad">
        <template v-if="!searches.length">No searches yet.</template>
        <template v-else-if="show === 'liked'">Nothing saved yet · 👍 a flat to keep it here.</template>
        <template v-else-if="show === 'passed' && counts.rejected">No matches yet · {{ counts.rejected }} rejected.</template>
        <template v-else>Nothing here.</template>
      </div>
      <div v-else class="list">
        <FlatRow
          v-for="i in feed" :key="i.search_id + ':' + i.source + ':' + i.source_id" :item="i" :checked="show === 'liked'"
          :busy="isBusy(i)" @verdict="verdict(i, $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 48px 0; text-align: center; }
.prof { margin-top: 14px; }
.q { margin: -4px 2px 10px; }
.list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
</style>
