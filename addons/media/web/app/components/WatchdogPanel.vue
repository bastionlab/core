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
  <Panel title="Auto-repair" :sub="w ? ago : 'no report yet'">
    <div v-if="!w" class="faint small">qb-watchdog in CT 106 has not reported yet.</div>
    <template v-else>
      <div v-if="!w.ok" class="small bad note">The repair pass could not run.</div>
      <div v-else-if="stale" class="small warn note">No pass for over an hour — check <code>qb-watchdog.timer</code> in CT 106.</div>

      <p class="summary" :title="`judged by ${w.ai?.model ?? 'the local model'}`">{{ w.summary }}</p>

      <div v-for="(r, n) in rows" :key="n" class="row">
        <span class="pill" :class="r.tone">{{ r.kind }}</span>
        <span class="what">
          <span class="name">{{ r.name }}</span>
          <span v-if="r.why" class="small muted"> — {{ r.why }}</span>
        </span>
      </div>
      <div v-if="w.ai?.error" class="small warn note">Model unreachable: {{ w.ai.error }}</div>
    </template>
  </Panel>
</template>

<style scoped>
.note { margin: 8px 0; }
.summary { margin: 0; line-height: 1.5; color: var(--muted); }
.row { display: flex; gap: 8px; align-items: baseline; padding: 7px 0; }
.summary + .row { margin-top: 8px; }
.row + .row { border-top: 1px solid var(--line); }
.what { flex: 1; min-width: 0; }
.name { overflow-wrap: anywhere; font-weight: 500; }
</style>
