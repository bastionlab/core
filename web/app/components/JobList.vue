<script setup lang="ts">
import type { Job } from '~/composables/useAction'
defineProps<{ jobs: Job[] }>()
const emit = defineEmits<{ dismiss: [Job] }>()
</script>

<template>
  <div v-if="jobs.length" class="jobs">
    <div v-for="(j, i) in jobs" :key="i" class="job" :class="j.state">
      <div class="head">
        <span class="dot" :class="j.state === 'done' ? 'ok' : j.state === 'failed' ? 'bad' : 'warn'" />
        <b>{{ j.desc ?? j.name }}</b>
        <span class="pill" :class="{ ok: j.state === 'done', bad: j.state === 'failed' }">
          {{ j.state === 'running' ? 'running…' : j.state === 'done' ? 'done' : `failed (exit ${j.rc})` }}
        </span>
        <button class="btn ghost small" @click="emit('dismiss', j)">✕</button>
      </div>
      <pre v-if="j.log.length" class="log small">{{ j.log.slice(-14).join('\n') }}</pre>
    </div>
  </div>
</template>

<style scoped>
.jobs { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.job { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--warn); border-radius: 9px; padding: 8px 12px; }
.job.done { border-left-color: var(--ok); } .job.failed { border-left-color: var(--bad); }
.head { display: flex; align-items: center; gap: 8px; }
.head .pill { margin-left: auto; }
.log { white-space: pre-wrap; max-height: 200px; overflow-y: auto; background: var(--panel-2); border-radius: 6px; padding: 6px 8px; margin: 8px 0 0; font-family: var(--mono); }
</style>
