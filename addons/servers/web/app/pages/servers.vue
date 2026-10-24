<script setup lang="ts">
/** game servers in CT 110 (gameservers): docker compose stacks managed by gsm, friends join via a playit.gg tunnel */
useHead({ title: 'Servers · pve' })
const { data: g, error, refresh } = useShared<any>('games', '/api/games')
usePoll(refresh, 5000)

const tplById = computed(() => Object.fromEntries((g.value?.templates ?? []).map((t: any) => [t.id, t])))
const gb = (b: number) => (b / 2 ** 30).toFixed(0)

// --- new server ---
const pick = ref('')
const nf = reactive<Record<string, any>>({})
const nid = ref('')
const nname = ref('')
const creating = ref(false)
const cerr = ref('')
function choose(t: any) {
  pick.value = pick.value === t.id ? '' : t.id
  for (const k of Object.keys(nf)) delete nf[k]
  for (const f of t.fields) nf[f.key] = f.default === '@gen' ? '' : f.default
  const taken = new Set((g.value?.servers ?? []).map((s: any) => s.id))
  let id = t.id, n = 2
  while (taken.has(id)) id = `${t.id}-${n++}`
  nid.value = id; nname.value = t.name; cerr.value = ''
}
async function create() {
  creating.value = true; cerr.value = ''
  const settings = { ...nf }
  for (const f of tplById.value[pick.value]?.fields ?? []) if (f.default === '@gen' && !settings[f.key]) delete settings[f.key]
  try {
    await $fetch('/api/games/create', { method: 'POST', body: { template: pick.value, id: nid.value, name: nname.value, settings } })
    pick.value = ''; refresh()
  } catch (e: any) { cerr.value = e?.data?.statusMessage || e?.message || 'failed' }
  finally { creating.value = false }
}
const ramWarn = computed(() => {
  const t = tplById.value[pick.value]
  if (!t || !g.value?.mem) return ''
  const want = (nf.memory ?? t.ram) * 2 ** 30
  return want > g.value.mem.avail ? `only ${gb(g.value.mem.avail)} GB free in the container — stop another server first` : ''
})

// --- playit ---
const claiming = ref(false)
const claimUrl = ref('')
async function claim() {
  claiming.value = true
  try { const r: any = await $fetch('/api/games/playit', { method: 'POST', body: {} }); claimUrl.value = r.url || ''; refresh() }
  catch {} finally { claiming.value = false }
}
const p = computed(() => g.value?.playit)
const ctStart = async () => { await $fetch('/api/games/ct-start', { method: 'POST', body: {} }); setTimeout(refresh, 4000) }
</script>

<template>
  <div>
    <div v-if="error && !g" class="bad pad">Could not reach the agent: {{ error.statusMessage || error.message }}</div>
    <div v-else-if="g && g.ctStatus !== 'running'" class="pad">
      CT {{ g.ct }} (gameservers) is {{ g.ctStatus }}. <button class="btn" @click="ctStart">Start it</button>
    </div>

    <template v-else-if="g">
      <div class="strip small">
        <span class="pill">CT {{ g.ct }} · RAM {{ gb(g.mem.total - g.mem.avail) }}/{{ gb(g.mem.total) }} GB</span>
        <span class="pill">disk {{ gb(g.disk.free) }} GB free</span>
        <span v-if="p?.claimed" class="pill ok">playit tunnel {{ p.phase }}</span>
        <template v-else>
          <span class="pill warn">playit not linked</span>
          <a v-if="claimUrl || p?.claimUrl" class="btn primary" :href="claimUrl || p.claimUrl" target="_blank" rel="noopener">Link playit.gg ↗</a>
          <button v-else class="btn" :disabled="claiming" @click="claim">{{ claiming ? '…' : 'Set up friends access (playit.gg)' }}</button>
        </template>
      </div>
      <div v-if="!p?.claimed && (claimUrl || p?.claimUrl)" class="small faint hint">Open the link and approve the agent, then add a tunnel per server under Connect.</div>

      <div class="servers">
        <GameServer v-for="s in g.servers" :key="s.id" :s="s" :tpl="tplById[s.template]" :latest="g.atm10sky?.latest" :versions="g.atm10sky?.versions" @changed="refresh" />
      </div>
      <div v-if="!g.servers.length" class="small faint">No servers yet — pick a game below.</div>

      <Panel title="New server" id="games-new" :fold="g.servers.length ? 'closed' : 'open'">
        <div class="tpls">
          <button v-for="t in g.templates" :key="t.id" type="button" class="tpl" :class="{ on: pick === t.id }" @click="choose(t)">
            <span class="ico">{{ t.icon }}</span>
            <span><b>{{ t.name }}</b><br><span class="small faint">{{ t.desc }}</span><br><span class="small faint">~{{ t.ram }} GB RAM</span></span>
          </button>
        </div>
        <div v-if="pick" class="form">
          <label><span>ID</span><input v-model="nid" maxlength="24" pattern="[a-z0-9][a-z0-9-]*" autocapitalize="off"></label>
          <label><span>Display name</span><input v-model="nname" maxlength="40"></label>
          <label v-for="f in tplById[pick].fields" :key="f.key" :class="{ inline: f.type === 'bool' }" :title="f.help">
            <span>{{ f.label }}</span>
            <input v-if="f.type === 'bool'" v-model="nf[f.key]" type="checkbox">
            <select v-else-if="f.type === 'select'" v-model="nf[f.key]"><option v-for="o in f.options" :key="o" :value="o">{{ o }}</option></select>
            <input v-else-if="f.type === 'number'" v-model.number="nf[f.key]" type="number" :min="f.min" :max="f.max">
            <input v-else v-model="nf[f.key]" :placeholder="f.default === '@gen' ? 'generated if empty' : ''" autocapitalize="off">
          </label>
        </div>
        <div v-if="pick" class="row">
          <button class="btn primary" :disabled="creating || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(nid)" @click="create">{{ creating ? 'Creating…' : 'Create & start' }}</button>
          <span v-if="ramWarn" class="small warn">{{ ramWarn }}</span>
          <span v-if="cerr" class="small bad">{{ cerr }}</span>
        </div>
      </Panel>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }
.strip { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.hint { margin: 0 0 12px; }
.servers { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(460px, 100%), 1fr)); gap: 14px; margin: 12px 0 16px; align-items: start; }
.tpls { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); gap: 10px; }
.tpl { display: flex; gap: 10px; text-align: left; padding: 12px; border-radius: var(--radius); border: 1px solid var(--line-2); background: var(--panel-2); color: var(--text); font: inherit; cursor: pointer; }
.tpl.on { border-color: var(--accent); background: var(--accent-soft); }
.tpl .ico { font-size: 26px; }
.form { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 14px; margin: 14px 0 10px; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--muted); }
.form label.inline { flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
</style>
