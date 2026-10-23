<script setup lang="ts">
useHead({ title: 'Jobs · pve' })

const show = ref<'passed' | 'rejected' | 'pending' | 'applied'>('passed')
const { selected, d, error, pending, load, searches, st, counts, feed, tabs, feedback, verdict, isBusy, onChanged } = useHunter('/api/jobs', 30000,
  sel => ({ search: sel ?? undefined, show: show.value, limit: 200 }), [show])

const VIEWS = computed(() => [
  { v: 'passed', label: 'Passend', n: counts.value.passed },
  { v: 'applied', label: 'Gemerkt & beworben', n: counts.value.applied },
  { v: 'pending', label: 'wird gelesen', n: counts.value.pending },
  { v: 'rejected', label: 'Aussortiert', n: counts.value.rejected },
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
    <div v-if="!d && pending" class="muted pad">Lade Jobs…</div>
    <div v-else-if="error && !d" class="bad pad">
      Die Job-API in CT 107 ist nicht erreichbar: {{ errText(error) }}
    </div>

    <template v-if="d">
      <!-- searches poll every 2 h; a loop tick is 2 min. Nothing for 3 h means it is stuck. -->
      <HunterStrip :st="st" :max-age="3 * 3600" :pending="pending" @reload="load">
        <span class="muted"><b>{{ st.seen_24h }}</b> neu 24h</span>
        <span v-if="st.pending" class="muted"><b>{{ st.pending }}</b> werden gelesen</span>
        <span v-if="perSource" class="faint src">{{ perSource }}</span>
      </HunterStrip>

      <JobCv :search="selected" :searches="searches" @changed="load" />
      <JobSearches class="srch" :searches="searches" :sources="st.sources ?? []" :has-cv="st.cv" @changed="onChanged" />

      <HunterTabs v-model:show="show" v-model:selected="selected" title="Stellen" :views="VIEWS" :tabs="tabs()" />

      <div v-if="!feed.length" class="muted pad">
        <template v-if="!searches.length">Lade einen Lebenslauf hoch und leg eine Suche an.</template>
        <template v-else-if="show === 'passed' && counts.pending">Die KI liest gerade {{ counts.pending }} Stellen…</template>
        <template v-else-if="show === 'passed' && counts.rejected">Noch nichts Passendes · {{ counts.rejected }} aussortiert.</template>
        <template v-else>Nichts hier.</template>
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
