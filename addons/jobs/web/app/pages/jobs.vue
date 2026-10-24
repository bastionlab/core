<script setup lang="ts">
useHead({ title: 'Jobs · pve' })

const show = ref<'passed' | 'rejected' | 'pending' | 'applied'>('passed')
const { selected, d, error, pending, load, searches, st, counts, feed, tabs, feedback, verdict, isBusy, onChanged } = useHunter('/api/jobs', 30000,
  sel => ({ search: sel ?? undefined, show: show.value, limit: 200 }), [show])

const VIEWS = computed(() => [
  { v: 'passed', label: 'Matches', n: counts.value.passed },
  { v: 'applied', label: 'Saved & applied', n: counts.value.applied },
  { v: 'pending', label: 'reading', n: counts.value.pending },
  { v: 'rejected', label: 'Rejected', n: counts.value.rejected },
] as const)
const labels = computed(() => Object.fromEntries((st.value?.sources ?? []).map((s: any) => [s.id, s.label])))
const perSource = computed(() => Object.entries(st.value?.per_source ?? {}).sort((a: any, b: any) => b[1] - a[1])
  .map(([k, v]) => `${v} ${labels.value[k] ?? k}`).join(' · '))

function applied(item: any, v: boolean) {
  const before = item.applied_at
  feedback(item, { action: 'applied', applied: v }, () => { item.applied_at = v ? Date.now() / 1000 : null }, () => { item.applied_at = before })
}
</script>

<template>
  <div>
    <div v-if="!d && pending" class="muted pad">Loading jobs…</div>
    <div v-else-if="error && !d" class="bad pad">
      The jobs API in CT 107 is unreachable: {{ errText(error) }}
    </div>

    <template v-if="d">
      <!-- searches poll every 2 h; a loop tick is 2 min. Nothing for 3 h means it is stuck. -->
      <HunterStrip :st="st" :max-age="3 * 3600" :pending="pending" @reload="load">
        <span class="muted"><b>{{ st.seen_24h }}</b> new 24h</span>
        <span v-if="st.pending" class="muted"><b>{{ st.pending }}</b> being read</span>
        <span v-if="perSource" class="faint src">{{ perSource }}</span>
      </HunterStrip>

      <JobCv :search="selected" :searches="searches" @changed="load" />
      <JobSearches class="srch" :searches="searches" :sources="st.sources ?? []" :has-cv="st.cv" @changed="onChanged" />

      <HunterTabs v-model:show="show" v-model:selected="selected" title="Postings" :views="VIEWS" :tabs="tabs()" />

      <div v-if="!feed.length" class="muted pad">
        <template v-if="!searches.length">Upload a CV and add a search.</template>
        <template v-else-if="show === 'passed' && counts.pending">The AI is reading {{ counts.pending }} postings…</template>
        <template v-else-if="show === 'passed' && counts.rejected">No matches yet · {{ counts.rejected }} rejected.</template>
        <template v-else>Nothing here.</template>
      </div>
      <div v-else class="list">
        <JobPosting
          v-for="i in feed" :key="i.search_id + ':' + i.source + ':' + i.source_id" :item="i"
          :busy="isBusy(i)" @verdict="verdict(i, $event)" @applied="applied(i, $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 48px 0; text-align: center; }
.srch { margin-top: 14px; }
.list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
</style>
