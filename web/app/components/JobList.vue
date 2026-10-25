<script setup lang="ts">
import type { Job } from '~/composables/useAction'
/** jobs as progress chips: spinner, latest log line and elapsed time while running; tap one for its whole log */
const props = defineProps<{ jobs: Job[], focus?: string | number }>()
const emit = defineEmits<{ dismiss: [Job] }>()
const open = ref<Set<Job>>(new Set())
const toggle = (j: Job) => { const s = new Set(open.value); if (s.has(j)) s.delete(j); else s.add(j); open.value = s }
watch(() => props.focus, (f) => { const j = props.jobs.find(j => (j.id ?? j.started) === f); if (j) open.value = new Set([...open.value, j]) }, { immediate: true })

const now = ref(Date.now())
let t: any
onMounted(() => (t = setInterval(() => (now.value = Date.now()), 1000)))
onUnmounted(() => clearInterval(t))
const elapsed = (j: Job) => { const s = Math.max(0, Math.round(((j.ended ?? now.value) - j.started) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const last = (j: Job) => [...j.log].reverse().find(l => l.trim())?.trim() ?? (j.state === 'running' ? 'starting…' : '')
</script>

<template>
  <div v-if="jobs.length" class="jobs">
    <div v-for="j in jobs" :key="j.id ?? j.started" class="job" :class="[j.state, { open: open.has(j) }]">
      <button type="button" class="head" :aria-expanded="open.has(j)" @click="toggle(j)">
        <span v-if="j.state === 'running' || j.state === 'checking'" class="spin" />
        <span v-else class="mark">{{ j.state === 'done' ? '✓' : '✗' }}</span>
        <span class="what">
          <b>{{ j.desc ?? j.name }}</b>
          <span class="line mono">{{ j.state === 'failed' && j.rc != null ? `exit ${j.rc} · ` : '' }}{{ last(j) }}</span>
        </span>
        <span class="time mono">{{ elapsed(j) }}</span>
      </button>
      <button type="button" class="btn ghost sm x" aria-label="Dismiss" @click="emit('dismiss', j)">✕</button>
      <pre v-if="open.has(j) && j.log.length" class="log small">{{ j.log.slice(-200).join('\n') }}</pre>
    </div>
  </div>
</template>

<style scoped>
.jobs { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.job {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 2px 4px 2px 0;
}
.job.open { border-radius: var(--radius-sm); }
.job.running { border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
.job.done { border-color: color-mix(in srgb, var(--ok) 35%, var(--line)); }
.job.failed { border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }
.head { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 6px 4px 6px 12px; background: none; border: 0; font: inherit; color: var(--text); text-align: left; cursor: pointer; }
.what { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.25; }
.what b { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line { font-size: 11px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.time { font-size: 11.5px; color: var(--muted); }
.mark { width: 16px; text-align: center; font-weight: 700; }
.done .mark { color: var(--ok); } .failed .mark { color: var(--bad); }
.spin { width: 14px; height: 14px; margin: 0 1px; border-radius: 50%; border: 2px solid var(--accent-soft); border-top-color: var(--accent); animation: spin .8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.x { border-radius: 999px; }
.log { grid-column: 1 / -1; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow-y: auto; background: var(--panel-2); border-radius: 6px; padding: 6px 8px; margin: 2px 6px 6px; font-family: var(--mono); }
@media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
</style>
