<script setup lang="ts">
import type { Proposal, Turn } from '~/composables/useAsk'
defineProps<{ turns: Turn[] }>()
const emit = defineEmits<{ run: [Proposal] }>()
</script>

<template>
  <div class="turns">
    <div v-for="(t, i) in turns" :key="i" class="turn">
      <div class="q">{{ t.q }}</div>
      <div v-if="t.tools?.length" class="tools small muted">
        <span v-for="(tl, j) in t.tools" :key="j" class="pill" :class="{ bad: tl.error }">
          <span class="dot" :class="tl.error ? 'bad' : tl.done ? 'ok' : 'warn'" />
          {{ tl.name === 'web_search' ? `searched “${tl.args?.query}”` : tl.name === 'fetch_page' ? `read ${(tl.args?.url || '').replace(/^https?:\/\//, '').slice(0, 40)}` : tl.name === 'weather' ? `weather ${tl.args?.location || ''}` : tl.name }}{{ tl.error ? ` — ${tl.error}` : '' }}
        </span>
      </div>
      <details v-if="t.r" class="reason small muted"><summary>reasoning{{ t.busy && !t.a ? '…' : '' }}</summary><div class="pre">{{ t.r }}</div></details>
      <div v-if="t.a" class="a" v-html="md(t.a)" />
      <div v-else-if="t.busy && !t.r" class="muted small">thinking… (first answer loads the model, can take ~20 s)</div>
      <div v-for="(p, j) in t.proposals" :key="'p' + j" class="proposal" :class="p.state">
        <div class="head">
          <span class="what"><b>{{ p.desc }}</b></span>
          <span v-if="p.state === 'idle'" class="btns">
            <button class="btn primary small" @click="emit('run', p)">Run</button>
            <button class="btn ghost small" @click="p.state = 'dismissed'">Dismiss</button>
          </span>
          <span v-else class="pill" :class="{ ok: p.state === 'done', bad: p.state === 'failed' }">
            {{ p.state === 'running' ? 'running…' : p.state === 'done' ? 'done' : p.state === 'failed' ? `failed (exit ${p.job?.rc})` : 'dismissed' }}
          </span>
        </div>
        <div v-if="p.why && p.state === 'idle'" class="muted small">{{ p.why }}</div>
        <pre v-if="p.job?.log?.length" class="log small">{{ p.job.log.slice(-12).join('\n') }}</pre>
      </div>
      <div v-if="t.error" class="small bad">{{ t.error }}</div>
      <div v-if="!t.busy && t.model" class="faint small">{{ t.model }}<template v-if="t.tps"> · {{ t.tps.toFixed(1) }} tok/s</template></div>
    </div>
  </div>
</template>

<style scoped>
.turn { padding: 10px 4px; display: flex; flex-direction: column; gap: 6px; }
.turn + .turn { border-top: 1px dashed var(--line); }
.q { font-weight: 600; }
.a { line-height: 1.55; overflow-wrap: anywhere; }
.a :deep(p) { margin: 0 0 8px; }
.a :deep(ul), .a :deep(ol) { margin: 0 0 8px; padding-left: 20px; }
.a :deep(pre) { background: var(--panel-2); padding: 8px 10px; border-radius: 7px; overflow-x: auto; }
.a :deep(code) { font-family: var(--mono); font-size: 12.5px; }
.a :deep(:not(pre) > code) { background: var(--panel-2); padding: 1px 4px; border-radius: 4px; }
.a :deep(table) { margin-bottom: 8px; font-size: 13px; }
.a :deep(h1), .a :deep(h2), .a :deep(h3) { font-size: 14px; margin: 10px 0 4px; }
.tools { display: flex; flex-wrap: wrap; gap: 6px; }
.tools .pill { gap: 6px; }
.proposal { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--panel-2); }
.proposal.done { border-left-color: var(--ok); }
.proposal.failed { border-left-color: var(--bad); }
.proposal.dismissed { opacity: .55; }
.proposal .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.proposal .btns { margin-left: auto; display: flex; gap: 6px; }
.proposal .btn.small { padding: 3px 10px; font-size: 12px; }
.log { white-space: pre-wrap; max-height: 160px; overflow-y: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; margin: 0; font-family: var(--mono); }
.reason summary { cursor: pointer; }
.pre { white-space: pre-wrap; max-height: 200px; overflow-y: auto; padding: 6px 0; }
</style>
