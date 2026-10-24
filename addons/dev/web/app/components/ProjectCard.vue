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
    if (action === 'start') { tab.value = kind === 'cc' ? 'claude' : 'preview'; snap.value = null }
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

// --- the tmux pane beside the card -----------------------------------------
type Tab = 'preview' | 'claude' | 'ship'
const tab = ref<Tab>('preview')
// the pane as tmux draws it: colours, real line breaks, its width (TermMirror renders it)
const snap = ref<{ log: string, cols: number, rows: number } | null>(null)
// /conduct: the repo's ship tmux session (conductor + lanes windows); null when the repo has no ship setup
const ship = computed(() => props.p.ship)
const shipLive = computed(() => !!ship.value?.running)
const shipTitle = computed(() => {
  const s = ship.value
  if (!s?.running) return `${s?.session}: not running`
  const b = s.board ?? {}
  return [s.conductor ? 'conductor running' : 'no conductor', `${s.lanes.length} lane(s)${s.lanes.length ? ': ' + s.lanes.join(', ') : ''}`,
    b.launched != null ? `launched ${b.launched}/${b.max}` : ''].filter(Boolean).join(' · ')
})
const session = computed(() => ({ claude: props.p.cc?.session, ship: ship.value?.session, preview: props.p.session })[tab.value])
const attach = computed(() => ({
  claude: props.p.cc?.attach,
  ship: ship.value?.attach,
  preview: `ssh -t max@${props.box.name} tmux a -t ${props.p.session}`,
})[tab.value])
const live = computed(() => ({
  claude: !!props.p.cc?.running,
  ship: shipLive.value,
  preview: !!props.p.running || props.p.exited != null,
})[tab.value])

// follow whichever session is actually alive, until the owner picks a tab themselves
const pinned = ref(false)
watchEffect(() => {
  if (pinned.value || props.p.running) return
  if (props.p.cc?.running) tab.value = 'claude'
  else if (shipLive.value) tab.value = 'ship'
})
const pick = (t: Tab) => { pinned.value = true; tab.value = t; snap.value = null; loadLog() }

async function loadLog() {
  if (!live.value) { snap.value = null; return }
  const t = tab.value
  const url = ({ claude: '/api/cc/log', ship: '/api/ship/log', preview: '/api/preview/log' })[t]
  try {
    const r: any = await $fetch(url, { query: { vmid: props.box.vmid, path: props.p.path, ansi: 1 } })
    if (t === tab.value) snap.value = r?.cols ? r : null
  } catch {}
}
const full = ref(false)

// the pane only exists while something runs, or when the owner opens it by hand
const opened = ref(false)
const anyLive = computed(() => !!props.p.running || props.p.exited != null || !!props.p.cc?.running || shipLive.value)
const showTerm = computed(() => anyLive.value || opened.value)
watch(showTerm, v => v && nextTick(loadLog))

let timer: any
onMounted(() => { loadLog(); timer = setInterval(() => !document.hidden && showTerm.value && loadLog(), 3000) })
onUnmounted(() => clearInterval(timer))

const copy = (s: string) => navigator.clipboard?.writeText(s)
</script>

<template>
  <div class="proj" :class="{ live: anyLive, wide: showTerm }">
    <div class="main">
      <div class="ph">
        <span class="dot" :class="p.running ? 'ok' : p.exited != null ? 'bad' : ''" :title="state" />
        <b class="pname" :title="p.path.replace('/home/max/', '~/')">{{ p.name }}</b>
        <a v-if="g.url" :href="g.url" target="_blank" class="repo small" title="open on GitHub">{{ g.repo }} ↗</a>
        <span v-if="p.exited != null" class="pill bad">{{ state }}</span>
      </div>

      <div class="git small">
        <span class="pill">⎇ {{ p.branch || 'no branch' }}</span>
        <span v-if="g.dirty" class="pill warn">{{ g.dirty }} changed</span>
        <span v-if="g.tracking && g.ahead" class="pill accent">↑{{ g.ahead }}</span>
        <span v-if="g.tracking && g.behind" class="pill warn">↓{{ g.behind }}</span>
        <span v-if="!g.remote" class="pill">no remote</span>
        <span v-else-if="!g.tracking" class="pill">no upstream</span>
        <span v-if="p.cc?.running" class="pill accent">✦ {{ p.cc.profile }}</span>
        <span v-if="shipLive" class="pill" :class="ship.conductor ? 'accent' : 'warn'" :title="shipTitle">
          ⚓ {{ ship.conductor ? 'conducting' : 'no conductor' }}{{ ship.lanes.length ? ` · ${ship.lanes.length} lane${ship.lanes.length > 1 ? 's' : ''}` : '' }}
        </span>
      </div>
      <div v-if="g.last" class="small faint last" :title="`${g.last.hash} · ${new Date(g.last.at).toLocaleString()}`">
        {{ g.last.subject }} · {{ ago(Date.parse(g.last.at) / 1000) }}
      </div>

      <div v-if="p.urls?.length" class="urls">
        <a v-for="u in p.urls" :key="u.port" :href="u.url" target="_blank" class="url" :class="{ pending: !u.url }">
          <span class="mono">:{{ u.port }}</span> {{ u.url ? 'Open ↗' : 'sharing…' }}
        </a>
      </div>
      <div v-else-if="p.running" class="small faint">waiting for a port…</div>

      <div v-if="error" class="small bad">{{ error }}</div>

      <div class="acts">
        <button v-if="!p.running" class="btn" :disabled="!p.command || !!busy" :title="p.command || 'no dev command found'" @click="call('preview', 'start')">
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
          <button class="btn ghost" title="git fetch --prune" @click="emit('action', 'git_fetch', { vmid: box.vmid, path: p.path })">↻</button>
          <button class="btn" :class="canPush ? 'primary' : 'ghost'" title="push" @click="showPush = !showPush">↑</button>
        </template>
        <!-- no remote yet: create the repo on GitHub and push it there -->
        <span v-else class="combo">
          <button class="btn" title="create the GitHub repo and push this project to it" @click="emit('action', 'github_publish', { vmid: box.vmid, path: p.path, visibility })">
            ⇪ GitHub
          </button>
          <select v-model="visibility" title="repo visibility">
            <option value="private">🔒</option>
            <option value="public">pub</option>
          </select>
        </span>
        <button v-if="!anyLive" class="btn ghost" :class="{ on: opened }" title="show the tmux pane" @click="opened = !opened">▤</button>
      </div>

      <div v-if="showPush" class="pushbox">
        <input v-model="message" :placeholder="g.dirty ? `commit message for ${g.dirty} file(s)` : 'nothing to commit — push only'" @keydown.enter.prevent="push">
        <button class="btn primary" @click="push">{{ message.trim() ? 'Commit & push' : 'Push' }}</button>
      </div>
    </div>

    <div v-if="showTerm" class="term">
      <div class="th">
        <button class="chip" :class="{ on: tab === 'preview' }" @click="pick('preview')">
          <span class="dot" :class="p.running ? 'ok' : p.exited != null ? 'bad' : ''" /> Preview
        </button>
        <button class="chip" :class="{ on: tab === 'claude' }" @click="pick('claude')">
          <span class="dot" :class="p.cc?.running ? 'ok' : ''" /> Claude
        </button>
        <button v-if="ship" class="chip" :class="{ on: tab === 'ship' }" :title="shipTitle" @click="pick('ship')">
          <span class="dot" :class="shipLive ? (ship.conductor ? 'ok' : 'warn') : ''" /> Ship
          <span v-if="ship.lanes?.length" class="lanes">{{ ship.lanes.length }}</span>
        </button>
        <code class="faint small mono attach" :title="`copy: ${attach}`" @click="copy(attach)">⧉ {{ session }}</code>
        <button v-if="live" class="btn ghost sm fs" title="open full screen and type into it" @click="full = true">⛶</button>
      </div>
      <div v-if="tab === 'ship' && shipLive && ship.lanes.length" class="lanerow small">
        <span v-for="l in ship.lanes" :key="l" class="pill">{{ l }}</span>
      </div>
      <div v-if="live && snap" class="pane" title="double-click to open full screen" @dblclick="full = true">
        <TermMirror :snap="snap" />
      </div>
      <pre v-else class="empty">{{ live ? '…' : tab === 'ship' ? `no ${ship?.session} session — start /conduct in the repo` : `nothing running in ${tab === 'claude' ? 'Claude' : 'Preview'}` }}</pre>
      <TermFull
        v-if="full" :vmid="box.vmid" :path="p.path" :target="tab === 'claude' ? 'cc' : tab" :title="`${p.name} · ${session}`"
        @close="full = false; loadLog()"
      />
    </div>
  </div>
</template>

<style scoped>
.proj {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px;
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: stretch; min-width: 0;
}
.proj.wide { grid-column: 1 / -1; grid-template-columns: minmax(280px, 4fr) minmax(320px, 7fr); }
.proj.live { border-color: color-mix(in srgb, var(--ok) 40%, var(--line)); }
.main { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.ph { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ph .dot { width: 7px; height: 7px; box-shadow: none; }
.pname { font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.repo { margin-left: auto; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.repo:hover { color: var(--accent); }
.git { display: flex; flex-wrap: wrap; gap: 5px; }
.last { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.urls { display: flex; flex-wrap: wrap; gap: 6px; }
.url { padding: 3px 10px; border-radius: var(--radius-sm); background: var(--ok-soft); color: var(--ok); font-size: 13px; }
.url.pending { background: var(--panel-2); color: var(--muted); }
.acts { display: flex; gap: 5px; margin-top: auto; padding-top: 4px; flex-wrap: wrap; align-items: center; }
.acts .btn { padding: 5px 10px; font-size: 12.5px; }
.acts .btn.ghost { min-width: 30px; padding: 5px 7px; }
.acts > .btn:first-child { color: var(--ok); }
.acts > .btn.danger:first-child { color: var(--bad); }
.acts .btn.ghost.on { color: var(--accent); background: var(--accent-soft); }
.combo { display: flex; }
.combo .btn { border-radius: 8px 0 0 8px; border-right: 0; }
.combo select { color: var(--muted); border-radius: 0 8px 8px 0; font-size: 11px; padding: 0 2px; width: 60px; }
@media (pointer: coarse) { .combo select { width: auto; min-width: 64px; min-height: 34px; padding: 0 6px; font-size: 13px; } }
.pushbox { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.pushbox input { flex: 1; min-width: 160px; padding: 6px 9px; }

.term { border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; background: var(--term-bg); min-width: 0; }
.th { display: flex; align-items: center; gap: 4px; padding: 4px 6px; background: var(--panel-2); border-bottom: 1px solid var(--line); }
.chip .dot { width: 6px; height: 6px; box-shadow: none; }
.chip .lanes { font-size: 10.5px; padding: 0 5px; border-radius: 8px; background: var(--panel); color: var(--muted); }
.lanerow { display: flex; flex-wrap: wrap; gap: 4px; padding: 5px 8px; border-bottom: 1px solid var(--line); background: var(--panel-2); }
.fs { font-size: 14px; }
.attach { margin-left: auto; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.pane { height: 300px; }
pre { margin: 0; padding: 10px 12px; height: 260px; overflow: auto; font: 12px/1.5 var(--mono); color: #d5d9e0; white-space: pre-wrap; word-break: break-all; }
pre.empty { color: var(--faint); display: grid; place-items: center; text-align: center; height: 120px; }
@media (max-width: 900px) {
  .proj.wide { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .proj { padding: 12px; gap: 10px; }
  pre { height: 50vh; font-size: 11px; padding: 8px; }
  .pane { height: 45vh; }
  pre.empty { height: 80px; }
  .acts .btn { min-height: 34px; }
}
</style>
