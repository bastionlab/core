<script setup lang="ts">
const props = defineProps<{ box: any, p: any }>()
const emit = defineEmits<{ refresh: [], action: [string, any] }>()

const busy = ref('')
const error = ref('')
const showPush = ref(false)
const message = ref('')
const profile = ref<'noven' | 'work'>('noven')
const visibility = ref<'private' | 'public'>('private')

const g = computed(() => props.p.git ?? {})
const state = computed(() => (props.p.running ? 'running' : props.p.exited != null ? `exited (${props.p.exited})` : 'stopped'))
const canPush = computed(() => !!g.value.remote && (g.value.ahead > 0 || g.value.dirty > 0))

async function call(kind: 'preview' | 'cc', action: string, body: any = {}) {
  busy.value = `${kind}:${action}`
  error.value = ''
  try {
    await $fetch(`/api/${kind}/${action}`, { method: 'POST', body: { vmid: props.box.vmid, path: props.p.path, ...body } })
    if (action === 'start') { tab.value = kind === 'cc' ? 'claude' : 'preview'; logText.value = '' }
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

// --- the tmux pane, always on beside the card ------------------------------
const tab = ref<'preview' | 'claude'>('preview')
const logText = ref('')
const logEl = ref<HTMLElement>()
const session = computed(() => (tab.value === 'claude' ? props.p.cc?.session : props.p.session))
const attach = computed(() => (tab.value === 'claude'
  ? props.p.cc?.attach
  : `ssh -t max@${props.box.name} tmux a -t ${props.p.session}`))
const live = computed(() => (tab.value === 'claude' ? !!props.p.cc?.running : !!props.p.running || props.p.exited != null))

// follow whichever session is actually alive, until the owner picks a tab themselves
const pinned = ref(false)
watchEffect(() => { if (!pinned.value && props.p.cc?.running && !props.p.running) tab.value = 'claude' })
const pick = (t: 'preview' | 'claude') => { pinned.value = true; tab.value = t; logText.value = ''; loadLog() }

async function loadLog() {
  if (!live.value) { logText.value = ''; return }
  const url = tab.value === 'claude' ? '/api/cc/log' : '/api/preview/log'
  try {
    const r: any = await $fetch(url, { query: { vmid: props.box.vmid, path: props.p.path } })
    const el = logEl.value
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40
    logText.value = stripAnsi(r.log || '').trimEnd()
    if (atBottom) nextTick(() => el && (el.scrollTop = el.scrollHeight))
  } catch {}
}
const full = ref(false)

let timer: any
onMounted(() => { loadLog(); timer = setInterval(() => !document.hidden && loadLog(), 3000) })
onUnmounted(() => clearInterval(timer))

const copy = (s: string) => navigator.clipboard?.writeText(s)
</script>

<template>
  <div class="proj" :class="{ live: p.running }">
    <!-- left: what the project is, and everything you can do to it -->
    <div class="main">
      <div class="ph">
        <b class="pname">{{ p.name }}</b>
        <a v-if="g.url" :href="g.url" target="_blank" class="pill accent" title="open on GitHub">{{ g.repo }} ↗</a>
        <span class="pill" :class="p.running ? 'ok' : p.exited != null ? 'bad' : ''">{{ state }}</span>
      </div>
      <div class="small muted mono path">{{ p.path.replace('/home/max/', '~/') }}</div>

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
      </div>

      <div v-if="error" class="small bad">{{ error }}</div>

      <!-- one row, everything you can press -->
      <div class="acts">
        <button v-if="!p.running" class="btn primary" :disabled="!p.command || !!busy" :title="p.command || 'no dev command found'" @click="call('preview', 'start')">
          {{ busy === 'preview:start' ? '…' : '▶ Preview' }}
        </button>
        <button v-else class="btn danger" :disabled="!!busy" @click="call('preview', 'stop')">■ Preview</button>

        <span v-if="!p.cc?.running" class="combo">
          <button class="btn" :disabled="!!busy" @click="call('cc', 'start', { profile })">{{ busy.startsWith('cc:') ? '…' : '✦ Claude' }}</button>
          <select v-model="profile" title="Claude Code profile">
            <option value="noven">noven</option>
            <option value="work">work</option>
          </select>
        </span>
        <button v-else class="btn danger" :disabled="!!busy" @click="call('cc', 'stop')">■ Claude</button>

        <template v-if="g.remote">
          <button class="btn" title="git fetch --prune" @click="emit('action', 'git_fetch', { vmid: box.vmid, path: p.path })">↻ Fetch</button>
          <button class="btn" :class="{ primary: canPush }" @click="showPush = !showPush">↑ Push</button>
        </template>
        <!-- no remote yet: create the repo on GitHub and push it there -->
        <span v-else class="combo">
          <button class="btn" title="create the GitHub repo and push this project to it" @click="emit('action', 'github_publish', { vmid: box.vmid, path: p.path, visibility })">
            ⇪ To GitHub
          </button>
          <select v-model="visibility" title="repo visibility">
            <option value="private">🔒</option>
            <option value="public">pub</option>
          </select>
        </span>
      </div>

      <div v-if="showPush" class="pushbox">
        <input v-model="message" placeholder="commit message (leave empty to push existing commits)" @keydown.enter.prevent="push">
        <button class="btn primary" @click="push">{{ message.trim() ? 'Commit & push' : 'Push' }}</button>
        <div class="small muted">
          {{ g.dirty ? `${g.dirty} file(s) changed — a message commits all of them.` : 'Working tree is clean.' }}
          {{ g.ahead ? `${g.ahead} commit(s) to push.` : '' }}
        </div>
      </div>
    </div>

    <!-- right: the tmux pane, live -->
    <div class="term">
      <div class="th">
        <button class="tab" :class="{ on: tab === 'preview' }" @click="pick('preview')">
          <span class="dot" :class="p.running ? 'ok' : p.exited != null ? 'bad' : ''" /> Preview
        </button>
        <button class="tab" :class="{ on: tab === 'claude' }" @click="pick('claude')">
          <span class="dot" :class="p.cc?.running ? 'ok' : ''" /> Claude
        </button>
        <code class="faint small mono attach" :title="`copy: ${attach}`" @click="copy(attach)">⧉ {{ session }}</code>
        <button v-if="live" class="tab fs" title="open full screen and type into it" @click="full = true">⛶</button>
      </div>
      <pre ref="logEl" :class="{ empty: !logText }">{{ logText || (live ? '…' : `nothing running — press ${tab === 'claude' ? '✦ Claude' : '▶ Preview'}`) }}</pre>
      <TermFull
        v-if="full" :vmid="box.vmid" :path="p.path" :target="tab === 'claude' ? 'cc' : 'preview'" :title="`${p.name} · ${session}`"
        @close="full = false; loadLog()"
      />
    </div>
  </div>
</template>

<style scoped>
.proj {
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 9px; padding: 12px 14px;
  display: grid; grid-template-columns: minmax(300px, 5fr) minmax(320px, 6fr); gap: 14px; align-items: stretch;
}
.proj.live { border-color: color-mix(in srgb, var(--ok) 50%, transparent); }
.main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ph { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pname { font-size: 15px; }
.ph .pill:last-child { margin-left: auto; }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git { display: flex; flex-wrap: wrap; gap: 5px; }
.last { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.urls { display: flex; flex-wrap: wrap; gap: 6px; }
.url { padding: 3px 10px; border-radius: 6px; background: var(--ok-soft); color: var(--ok); font-size: 13px; }
.url.pending { background: var(--panel); color: var(--muted); }
.cc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.acts { display: flex; gap: 6px; margin-top: auto; padding-top: 6px; flex-wrap: wrap; align-items: center; }
.acts .btn { flex: 1 1 auto; justify-content: center; padding: 5px 10px; min-width: max-content; }
.combo { display: flex; flex: 1 1 auto; min-width: max-content; }
.combo .btn { flex: 1; border-radius: 7px 0 0 7px; border-right: 0; }
.combo select {
  background: var(--panel); color: var(--muted); border: 1px solid var(--line); border-radius: 0 7px 7px 0;
  font: inherit; font-size: 11px; padding: 0 4px; width: 78px;
}
.pushbox { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.pushbox input { flex: 1; min-width: 160px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 7px; color: var(--text); font: inherit; font-size: 13px; padding: 5px 8px; }
.pushbox .small { flex-basis: 100%; }

.term { border: 1px solid var(--line); border-radius: 9px; overflow: hidden; background: #0a0c0f; min-width: 0; }
.th { display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
.tab { display: flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 6px; cursor: pointer; }
.tab:hover { color: var(--text); background: var(--panel-2); }
.tab.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.fs { font-size: 14px; padding: 2px 8px; }
.attach { margin-left: auto; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
pre { margin: 0; padding: 10px 12px; height: 280px; overflow: auto; font: 12px/1.5 var(--mono); color: #d5d9e0; white-space: pre-wrap; word-break: break-all; }
pre.empty { color: #5f6775; display: grid; place-items: center; text-align: center; }
@media (max-width: 900px) {
  .proj { grid-template-columns: minmax(0, 1fr); }
  pre { height: 260px; }
}
@media (max-width: 640px) {
  .proj { padding: 10px; gap: 10px; }
  pre { height: 55vh; font-size: 11px; padding: 8px; }
  pre.empty { height: 90px; }
  .ph .pill:last-child { margin-left: 0; }
}
</style>
