<script setup lang="ts">
/** one game server in CT 110: power, live console, settings form (from the template's fields), backups, tunnel address */
const props = defineProps<{ s: any, tpl: any, latest?: string | null, versions?: string[] }>()
const emit = defineEmits<{ changed: [] }>()
const { ip } = useDashConfig()
const LAN = computed(() => ip('gameservers'))

const tab = ref<'' | 'console' | 'settings' | 'backups' | 'connect'>('')
const busy = ref('')
const err = ref('')
const { armed, arm } = useArm()

async function act(action: string, extra: any = {}) {
  busy.value = action; err.value = ''
  try { await $fetch(`/api/games/${action}`, { method: 'POST', body: { id: props.s.id, ...extra } }); emit('changed'); return true }
  catch (e: any) { err.value = e?.data?.statusMessage || e?.data?.message || e?.message || 'failed'; return false }
  finally { busy.value = '' }
}

const running = computed(() => props.s.status === 'running')
const opBusy = computed(() => props.s.op && !props.s.op.done)
const state = computed(() => {
  if (opBusy.value) return { cls: 'warn', text: props.s.op.msg || props.s.op.op }
  if (!running.value) return { cls: '', text: props.s.status === 'missing' ? 'not created' : 'stopped' }
  if (props.s.health === 'starting') return { cls: 'warn', text: 'starting…' }
  if (props.s.health === 'unhealthy') return { cls: 'bad', text: 'running · unhealthy' }
  return { cls: 'ok', text: props.s.health === 'healthy' ? 'online' : 'running' }
})
const gb = (b: number) => (b / 2 ** 30).toFixed(1)

// --- console ---
const log = ref('')
const opLog = ref('')
const cmd = ref('')
const cmdOut = ref('')
const pre = ref<HTMLElement>()
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g
async function loadLog() {
  try {
    const r: any = await $fetch('/api/games/log', { query: { id: props.s.id, n: 400 } })
    const el = pre.value
    const stick = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40
    log.value = (r.log || '').replace(ANSI, '')
    opLog.value = r.op || ''
    if (stick) nextTick(() => { if (pre.value) pre.value.scrollTop = pre.value.scrollHeight })
  } catch {}
}
let timer: any
watch(tab, (t) => { clearInterval(timer); if (t === 'console') { loadLog(); timer = setInterval(() => !document.hidden && loadLog(), 3000) } })
onUnmounted(() => clearInterval(timer))
async function send() {
  const c = cmd.value.trim()
  if (!c) return
  busy.value = 'cmd'; cmdOut.value = ''
  try { const r: any = await $fetch('/api/games/cmd', { method: 'POST', body: { id: props.s.id, command: c } }); cmdOut.value = r.out || '(ok)'; cmd.value = ''; loadLog() }
  catch (e: any) { cmdOut.value = e?.data?.statusMessage || 'failed' }
  finally { busy.value = '' }
}

// --- settings ---
const form = reactive<Record<string, any>>({})
function resetForm() {
  for (const f of props.tpl?.fields ?? []) form[f.key] = props.s.settings?.[f.key]
  form.name = props.s.name
}
watch(tab, t => t === 'settings' && resetForm())
const saved = ref('')
async function save(apply: boolean) {
  saved.value = ''
  if (await act('set', { settings: { ...form }, apply })) saved.value = apply ? 'Saved — restarting with the new settings' : (running.value ? 'Saved — applies on the next restart' : 'Saved')
}
const showPw = ref(false)

// --- connect ---
const addr = ref(props.s.address || '')
const tunnels = computed(() => (props.s.ports || []).filter((p: any) => !p.local))
const mainPort = computed(() => tunnels.value[0]?.port)

const age = (t: number) => new Date(t * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const mb = (b: number) => b > 2 ** 30 ? `${gb(b)} GB` : `${Math.round(b / 2 ** 20)} MB`
const outdated = computed(() => props.s.template === 'atm10sky' && props.latest && props.s.pack?.version && props.s.pack.version !== props.latest)
const pickVer = ref('')
</script>

<template>
  <article class="gs" :class="state.cls">
    <header>
      <span class="ico">{{ s.icon }}</span>
      <div class="ttl">
        <div class="name">{{ s.name }}</div>
        <div class="small faint">{{ s.kind }}<template v-if="s.pack?.version"> · pack {{ s.pack.version }}</template></div>
      </div>
      <span class="st small"><span class="dot" :class="state.cls" /> {{ state.text }}</span>
    </header>

    <div class="facts small">
      <span v-if="s.players" class="pill" :class="s.players.online ? 'ok' : ''" :title="s.players.names.join(', ')">👥 {{ s.players.online }}/{{ s.players.max }}<template v-if="s.players.names.length"> · {{ s.players.names.join(', ') }}</template></span>
      <span v-if="running" class="pill">RAM {{ gb(s.mem) }} / {{ gb(s.memLimit) }} GB</span>
      <span v-if="running" class="pill">CPU {{ s.cpu.toFixed(0) }}%</span>
      <button type="button" class="pill addr" :title="'how to connect'" @click="tab = tab === 'connect' ? '' : 'connect'">
        {{ s.address || `${LAN}:${mainPort}` }}
      </button>
      <span v-if="outdated" class="pill warn">pack {{ latest }} available</span>
    </div>

    <div v-if="s.op?.error" class="errbox small">⚠ {{ s.op.op }} failed: {{ s.op.error }}</div>
    <div v-if="err" class="errbox small">⚠ {{ err }}</div>

    <div class="row">
      <button v-if="!running" class="btn primary" :disabled="!!busy || opBusy" @click="act('start')">{{ busy === 'start' ? 'Starting…' : '▶ Start' }}</button>
      <button v-else class="btn" :disabled="!!busy || opBusy" @click="act('stop')">{{ busy === 'stop' ? 'Stopping…' : '■ Stop' }}</button>
      <button v-if="running" class="btn" :disabled="!!busy || opBusy" @click="act('restart')">{{ busy === 'restart' ? 'Restarting…' : '↻ Restart' }}</button>
      <span class="seg tabs">
        <button v-for="t in (['console', 'settings', 'backups', 'connect'] as const)" :key="t" type="button" :class="{ on: tab === t }" @click="tab = tab === t ? '' : t">{{ t[0].toUpperCase() + t.slice(1) }}</button>
      </span>
    </div>

    <div v-if="tab === 'console'" class="pane">
      <pre ref="pre" class="log">{{ log || (opLog ? opLog : 'no output yet') }}</pre>
      <form v-if="s.console" class="cmd" @submit.prevent="send">
        <input v-model="cmd" :placeholder="s.game === 'minecraft' ? 'command, e.g. whitelist add Steve' : 'RCON command, e.g. ListPlayers'" :disabled="!running" maxlength="200" autocapitalize="off" autocomplete="off">
        <button class="btn" :disabled="!running || busy === 'cmd' || !cmd.trim()">Send</button>
      </form>
      <div v-else class="small faint">This game has no server console — manage it in-game (Satisfactory: Server Manager).</div>
      <pre v-if="cmdOut" class="out small">{{ cmdOut }}</pre>
    </div>

    <div v-if="tab === 'settings'" class="pane">
      <div class="form">
        <label><span>Display name</span><input v-model="form.name" maxlength="40"></label>
        <label v-for="f in tpl?.fields ?? []" :key="f.key" :class="{ inline: f.type === 'bool' }" :title="f.help">
          <span>{{ f.label }}</span>
          <input v-if="f.type === 'bool'" v-model="form[f.key]" type="checkbox">
          <select v-else-if="f.type === 'select'" v-model="form[f.key]"><option v-for="o in f.options" :key="o" :value="o">{{ o }}</option></select>
          <input v-else-if="f.type === 'number'" v-model.number="form[f.key]" type="number" :min="f.min" :max="f.max">
          <input v-else-if="f.type === 'password'" v-model="form[f.key]" :type="showPw ? 'text' : 'password'" autocomplete="off">
          <input v-else v-model="form[f.key]" maxlength="400" autocapitalize="off">
        </label>
      </div>
      <div class="row">
        <button v-if="running" class="btn primary" :disabled="!!busy" @click="save(true)">Save &amp; restart</button>
        <button class="btn" :class="{ primary: !running }" :disabled="!!busy" @click="save(false)">Save</button>
        <button v-if="tpl?.fields?.some((f: any) => f.type === 'password')" class="btn ghost" @click="showPw = !showPw; for (const f of tpl.fields) if (f.type === 'password') form[f.key] = showPw ? (s.secrets?.[f.key] ?? '') : '••••••••'">{{ showPw ? 'Hide' : 'Show' }} passwords</button>
        <span v-if="saved" class="small ok">{{ saved }}</span>
      </div>
      <template v-if="s.template === 'atm10sky'">
        <h4>Modpack</h4>
        <div class="row small">
          <span class="faint">installed {{ s.pack?.version ?? '–' }} · NeoForge {{ s.pack?.neoforge ?? '–' }}</span>
          <select v-model="pickVer" class="ver"><option value="">latest ({{ latest }})</option><option v-for="v in versions" :key="v" :value="v">{{ v }}</option></select>
          <button class="btn" :disabled="!!busy || opBusy" title="Old mods are moved to _trash; the world stays. Players need the same pack version." @click="act('update', { version: pickVer || 'latest' })">Install pack</button>
        </div>
      </template>
      <template v-else>
        <h4>Game update</h4>
        <div class="row small"><button class="btn" :disabled="!!busy || opBusy" title="SteamCMD fetches the newest build on start" @click="act('update')">Update &amp; restart</button></div>
      </template>
      <h4>Remove</h4>
      <div class="row small">
        <button class="btn danger" :class="{ sure: armed === 'rm' }" :disabled="!!busy" title="stops it and moves its folder + backups to /srv/games/_trash (nothing is deleted)" @click="arm('rm') && act('remove')">{{ armed === 'rm' ? 'Sure?' : 'Remove server' }}</button>
      </div>
    </div>

    <div v-if="tab === 'backups'" class="pane">
      <div class="row">
        <button class="btn" :disabled="!!busy || opBusy" :title="`world only · last 10 kept · /srv/games/_backups/${s.id}`" @click="act('backup')">{{ s.op?.op === 'backup' && opBusy ? 'Backing up…' : '⤓ Back up now' }}</button>
      </div>
      <div v-if="!s.backups?.length" class="small faint">No backups yet.</div>
      <div v-for="b in s.backups" :key="b.file" class="bk small">
        <span>{{ age(b.time) }}</span><span class="faint">{{ mb(b.size) }}</span>
        <button class="btn ghost" :class="{ sure: armed === b.file }" :disabled="!!busy || opBusy" title="stops the server; the current world is kept in _trash" @click="arm(b.file) && act('restore', { file: b.file })">{{ armed === b.file ? 'Sure?' : 'Restore' }}</button>
      </div>
    </div>

    <div v-if="tab === 'connect'" class="pane small">
      <div><b>At home / tailnet:</b> <code>{{ LAN }}:{{ mainPort }}</code></div>
      <div class="faint">For friends, add a tunnel per port on <a href="https://playit.gg/account/tunnels" target="_blank" rel="noopener">playit.gg → Tunnels</a> (agent “pve-gameservers”):</div>
      <ul>
        <li v-for="p in tunnels" :key="p.name + p.proto">{{ p.tunnel }} tunnel → local <code>127.0.0.1:{{ p.port }}</code> <span class="faint">({{ p.name }}, {{ p.proto }})</span></li>
      </ul>
      <label class="addrin"><span>Public address (what friends type)</span>
        <span class="row"><input v-model="addr" placeholder="e.g. something.joinmc.link" autocapitalize="off"><button class="btn" :disabled="!!busy" @click="act('set', { settings: { address: addr } })">Save</button></span>
      </label>
    </div>
  </article>
</template>

<style scoped>
.gs { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.gs.ok { border-color: color-mix(in srgb, var(--ok) 35%, var(--line)); }
header { display: flex; align-items: center; gap: 10px; }
.ico { font-size: 26px; line-height: 1; }
.ttl { min-width: 0; flex: 1; }
.name { font-weight: 600; }
.st { display: flex; align-items: center; gap: 6px; color: var(--muted); text-align: right; }
.facts { display: flex; flex-wrap: wrap; gap: 6px; }
.addr { cursor: pointer; font-family: var(--mono); }
@media (pointer: coarse) { .addr { min-height: 32px; padding: 4px 12px; font-size: 12.5px; } }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tabs { margin-left: auto; }
.pane { border-top: 1px solid var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.log { margin: 0; height: 320px; overflow: auto; background: var(--term-bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: 11.5px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; color: #c8ccd4; }
.cmd { display: flex; gap: 6px; }
.cmd input { flex: 1; min-width: 0; font-family: var(--mono); }
.out { margin: 0; white-space: pre-wrap; background: var(--panel-2); border-radius: 8px; padding: 6px 10px; font-family: var(--mono); }
.form { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 14px; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--muted); }
.form label.inline { flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; }
h4 { margin: 8px 0 0; font-size: 12.5px; color: var(--muted); font-weight: 600; }
.ver { width: auto; }
.bk { display: flex; gap: 12px; align-items: center; padding: 2px 0; border-bottom: 1px solid var(--line); }
.bk .btn { margin-left: auto; }
ul { margin: 0; padding-left: 18px; }
code { font-family: var(--mono); background: var(--panel-2); padding: 1px 5px; border-radius: 5px; }
.addrin { display: flex; flex-direction: column; gap: 4px; }
.addrin input { flex: 1; min-width: 0; }
@media (max-width: 640px) { .tabs { margin-left: 0; } .log { height: 260px; } }
</style>
