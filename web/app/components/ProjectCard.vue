<script setup lang="ts">
const props = defineProps<{ box: any, p: any }>()
const emit = defineEmits<{ refresh: [], action: [string, any] }>()

const busy = ref('')
const error = ref('')
const showPush = ref(false)
const message = ref('')
const profile = ref<'noven' | 'work'>('noven')
const log = ref<{ kind: 'preview' | 'claude' } | null>(null)
const logText = ref('')
const logEl = ref<HTMLElement>()

const g = computed(() => props.p.git ?? {})
const state = computed(() => (props.p.running ? 'running' : props.p.exited != null ? `exited (${props.p.exited})` : 'stopped'))
const canPush = computed(() => !!g.value.remote && (g.value.ahead > 0 || g.value.dirty > 0))

async function call(kind: 'preview' | 'cc', action: string, body: any = {}) {
  busy.value = `${kind}:${action}`
  error.value = ''
  try {
    await $fetch(`/api/${kind}/${action}`, { method: 'POST', body: { vmid: props.box.vmid, path: props.p.path, ...body } })
    if (action === 'start') openLog(kind === 'cc' ? 'claude' : 'preview')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || e?.message
  } finally {
    busy.value = ''
    emit('refresh')
  }
}

function push() {
  emit('action', 'git_push', { vmid: props.box.vmid, path: props.p.path, ...(message.value.trim() ? { message: message.value.trim() } : {}) })
  showPush.value = false
  message.value = ''
}

async function loadLog() {
  if (!log.value) return
  const url = log.value.kind === 'claude' ? '/api/cc/log' : '/api/preview/log'
  try {
    const r: any = await $fetch(url, { query: { vmid: props.box.vmid, path: props.p.path } })
    const el = logEl.value
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40
    logText.value = stripAnsi(r.log || '').trimEnd()
    if (atBottom) nextTick(() => el && (el.scrollTop = el.scrollHeight))
  } catch {}
}
function openLog(kind: 'preview' | 'claude') {
  log.value = { kind }
  logText.value = ''
  loadLog()
}
let timer: any
onMounted(() => (timer = setInterval(loadLog, 2000)))
onUnmounted(() => clearInterval(timer))

const copy = (s: string) => navigator.clipboard?.writeText(s)
</script>

<template>
  <div class="proj" :class="{ live: p.running }">
    <div class="ph">
      <b>{{ p.name }}</b>
      <a v-if="g.url" :href="g.url" target="_blank" class="pill accent" title="open on GitHub">{{ g.repo }} ↗</a>
      <span class="pill" :class="p.running ? 'ok' : p.exited != null ? 'bad' : ''">{{ state }}</span>
    </div>
    <div class="small muted mono path">{{ p.path.replace('/home/max/', '~/') }}</div>

    <!-- git -->
    <div class="git small">
      <span class="pill">⎇ {{ p.branch || 'no branch' }}</span>
      <span v-if="g.dirty" class="pill warn">{{ g.dirty }} uncommitted</span>
      <span v-else class="pill ok">clean</span>
      <span v-if="g.tracking && g.ahead" class="pill accent">↑{{ g.ahead }}</span>
      <span v-if="g.tracking && g.behind" class="pill warn">↓{{ g.behind }}</span>
      <span v-if="!g.remote" class="pill">no remote</span>
      <span v-else-if="!g.tracking" class="pill">no upstream</span>
    </div>
    <div v-if="g.last" class="small faint last" :title="new Date(g.last.at).toLocaleString()">
      {{ g.last.hash }} {{ g.last.subject }} · {{ ago(Date.parse(g.last.at) / 1000) }}
    </div>

    <div v-if="p.urls?.length" class="urls">
      <a v-for="u in p.urls" :key="u.port" :href="u.url" target="_blank" class="url" :class="{ pending: !u.url }">
        <span class="mono">:{{ u.port }}</span> {{ u.url ? 'Open ↗' : 'sharing…' }}
      </a>
    </div>
    <div v-else-if="p.running" class="small faint">waiting for a listening port…</div>

    <div v-if="p.cc?.running" class="cc small">
      <span class="dot ok" /> Claude Code running <span class="pill accent">{{ p.cc.profile }}</span>
      <code class="faint mono attach" :title="p.cc.attach" @click="copy(p.cc.attach)">{{ p.cc.attach }} ⧉</code>
    </div>

    <div v-if="error" class="small bad">{{ error }}</div>

    <div class="acts">
      <button v-if="!p.running" class="btn primary" :disabled="!p.command || !!busy" @click="call('preview', 'start')">
        {{ busy === 'preview:start' ? 'Starting…' : '▶ Preview' }}
      </button>
      <button v-else class="btn danger" :disabled="!!busy" @click="call('preview', 'stop')">■ Stop preview</button>

      <button v-if="!p.cc?.running" class="btn" :disabled="!!busy" @click="call('cc', 'start', { profile })">
        {{ busy.startsWith('cc:') ? 'Starting…' : '✦ Claude' }}
      </button>
      <select v-if="!p.cc?.running" v-model="profile" class="small" title="Claude Code profile">
        <option value="noven">noven</option>
        <option value="work">work</option>
      </select>
      <button v-else class="btn danger" :disabled="!!busy" @click="call('cc', 'stop')">■ Stop Claude</button>

      <button class="btn" :disabled="!g.remote" title="git fetch --prune" @click="emit('action', 'git_fetch', { vmid: box.vmid, path: p.path })">↻ Fetch</button>
      <button class="btn" :class="{ primary: canPush }" :disabled="!g.remote" @click="showPush = !showPush">↑ Push</button>
      <button v-if="p.running || p.exited != null" class="btn ghost" @click="openLog('preview')">Preview log</button>
      <button v-if="p.cc?.running" class="btn ghost" @click="openLog('claude')">Claude log</button>
    </div>

    <div v-if="showPush" class="pushbox">
      <input v-model="message" placeholder="commit message (leave empty to push existing commits)" @keydown.enter.prevent="push">
      <button class="btn primary" @click="push">{{ message.trim() ? 'Commit & push' : 'Push' }}</button>
      <div class="small muted">
        {{ g.dirty ? `${g.dirty} file(s) changed — a message commits all of them.` : 'Working tree is clean.' }}
        {{ g.ahead ? `${g.ahead} commit(s) to push.` : '' }}
      </div>
    </div>

    <div v-if="log" class="logbox">
      <div class="lh">
        <b>{{ log.kind === 'claude' ? 'Claude Code' : 'Preview' }}</b>
        <span class="muted small mono">tmux a -t {{ log.kind === 'claude' ? p.cc?.session : p.session }}</span>
        <button class="btn ghost small" style="margin-left:auto" @click="log = null">✕</button>
      </div>
      <pre ref="logEl">{{ logText || '…' }}</pre>
    </div>
  </div>
</template>

<style scoped>
.proj { background: var(--panel-2); border: 1px solid var(--line); border-radius: 9px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.proj.live { border-color: color-mix(in srgb, var(--ok) 50%, transparent); }
.ph { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ph .pill:last-child { margin-left: auto; }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git { display: flex; flex-wrap: wrap; gap: 5px; }
.last { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.urls { display: flex; flex-wrap: wrap; gap: 6px; }
.url { padding: 3px 10px; border-radius: 6px; background: var(--ok-soft); color: var(--ok); font-size: 13px; }
.url.pending { background: var(--panel); color: var(--muted); }
.cc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.attach { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acts { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; align-items: center; }
.acts select { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 7px; padding: 4px 6px; font: inherit; font-size: 12px; }
.pushbox { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.pushbox input { flex: 1; min-width: 200px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 7px; color: var(--text); font: inherit; font-size: 13px; padding: 5px 8px; }
.pushbox .small { flex-basis: 100%; }
.logbox { margin-top: 8px; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.lh { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--panel); }
pre { margin: 0; padding: 10px 12px; max-height: 320px; overflow: auto; font: 12px/1.5 var(--mono); background: #0a0c0f; color: #d5d9e0; white-space: pre-wrap; word-break: break-all; }
</style>
