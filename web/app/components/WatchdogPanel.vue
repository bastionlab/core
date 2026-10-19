<script setup lang="ts">
/** qb-watchdog.py in CT 106 repairs downloads that can never finish. This panel is the
 *  only place it reports to, so a missing or stale pass has to be visible as well. */
const props = defineProps<{ w: any }>()

const ago = computed(() => {
  const a = props.w?.age ?? 0
  if (a < 90) return 'just now'
  if (a < 5400) return `${Math.round(a / 60)} min ago`
  return `${Math.round(a / 3600)} h ago`
})
const stale = computed(() => (props.w?.age ?? 0) > 3600)
const rows = computed(() => [
  ...(props.w?.alerts ?? []).map((a: string) => ({ kind: 'needs you', tone: 'bad', name: a, why: '' })),
  ...(props.w?.acted ?? []).map((a: any) => ({ kind: 'repaired', tone: 'accent', name: a.name, why: a.why })),
  ...(props.w?.watching ?? []).map((x: any) => ({ kind: 'watching', tone: '', name: x.name, why: x.why })),
])
</script>

<template>
  <Panel title="Stuck-download repair" :sub="w ? `last pass ${ago}` : 'no report yet'">
    <div v-if="!w" class="faint small">qb-watchdog in CT 106 has not reported yet.</div>
    <template v-else>
      <div v-if="!w.ok" class="small bad note">The repair pass could not run.</div>
      <div v-else-if="stale" class="small warn note">
        No pass for over an hour — check <code>qb-watchdog.timer</code> in CT 106.
      </div>

      <p class="summary">{{ w.summary }}</p>

      <div v-for="(r, n) in rows" :key="n" class="row">
        <span class="pill" :class="r.tone">{{ r.kind }}</span>
        <span class="what">
          <b class="name">{{ r.name }}</b>
          <span v-if="r.why" class="small muted"> — {{ r.why }}</span>
        </span>
      </div>

      <div class="small faint foot">
        Rules decide and act on their own; {{ w.ai?.model ?? 'the local model' }} judges what they
        do not recognise and writes this note.
        <span v-if="w.ai?.error" class="warn">Model unreachable: {{ w.ai.error }}</span>
      </div>
    </template>
  </Panel>
</template>

<style scoped>
.note { margin-bottom: 8px; }
.summary { margin: 0 0 10px; line-height: 1.45; }
.row { display: flex; gap: 8px; align-items: baseline; padding: 6px 0; }
.row + .row { border-top: 1px solid var(--line); }
.what { flex: 1; min-width: 0; }
.name { overflow-wrap: anywhere; }
.foot { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--line); }
</style>
