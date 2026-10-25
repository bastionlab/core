<script setup lang="ts">
/** every add-on of this dashboard (who built it, what it needs, on/off) and the marketplace of ones not installed yet */
useHead({ title: 'Add-ons · Bastion' })
const { list, off, load, isOn, set } = useAddons()
const { data: o } = useOverview()
const { ctId } = useDashConfig()
onMounted(load)

// marketplace index (server/utils/marketplace.ts): Update badges here, the not-installed ones below
const { data: market } = useFetch<any>('/api/marketplace', { server: false })
const refreshing = ref(false)
async function refreshMarket(fresh = true) {
  refreshing.value = fresh
  try { market.value = await $fetch<any>('/api/marketplace', { query: fresh ? { fresh: '1' } : {} }) } catch { /* keep what we have */ } finally { refreshing.value = false }
}
// new versions and add-ons show up while the page is open; the agent installs updates by itself every hour
let poll: any
onMounted(() => { poll = setInterval(() => refreshMarket(false), 5 * 60_000) })
onBeforeUnmount(() => clearInterval(poll))
/** 'new' | 'changed': this box's folder differs from the marketplace's, so it can be published */
const publishable = (id: string) => market.value?.local?.[id] as string | undefined
const entry = (id: string) => market.value?.addons?.find((e: any) => e.id === id)
const coreVersion = useRuntimeConfig().public.coreVersion as string
const available = computed(() => (market.value?.addons ?? []).filter((e: any) => !e.installed))
const count = (n: number | null) => (n == null ? '' : `${n} install${n === 1 ? '' : 's'}`)

// install / update / remove: the agent describes exactly what will happen, Run arms after a moment
// (third-party code, root on pve), then deploy.sh rebuilds the app in its own unit
const { jobs, run, dismiss } = useActions()
const pending = ref<{ name: string, id: string, desc: string } | null>(null)
// install / update: agent/addon_scan.py's safety check of what would land; blocking findings disable Run
// (addon-get checks again and refuses anyway)
const scan = ref<{ state: 'loading' | 'done' | 'error', rep?: any, error?: string } | null>(null)
const blocked = computed(() => scan.value?.state === 'done' && !scan.value.rep.ok)
const shown = computed(() => (scan.value?.rep?.findings ?? []).filter((f: any) => f.level !== 'info'))
const notes = computed(() => (scan.value?.rep?.findings ?? []).filter((f: any) => f.level === 'info'))
async function check(id: string) {
  scan.value = { state: 'loading' }
  try {
    const rep = await $fetch<any>('/api/marketplace/scan', { query: { id }, timeout: 200_000 })
    if (pending.value?.id === id) scan.value = { state: 'done', rep }
  } catch (e: any) {
    if (pending.value?.id === id) scan.value = { state: 'error', error: e?.data?.statusMessage || e?.statusMessage || e?.message }
  }
}
const armed = ref(false)
let armTimer: any
async function ask(name: string, id: string) {
  error.value = ''
  try {
    const r = await $fetch<{ desc: string }>('/api/ai/action/check', { method: 'POST', body: { name, args: { id } } })
    pending.value = { name, id, desc: r.desc }
    scan.value = null
    if (name === 'addon_install' || name === 'addon_update') check(id)
    armed.value = false
    clearTimeout(armTimer)
    armTimer = setTimeout(() => (armed.value = true), 1500)
  } catch (e: any) { error.value = e?.data?.statusMessage || e?.statusMessage || e?.message }
}
function go() {
  const p = pending.value
  if (!p || !armed.value || blocked.value) return
  pending.value = null
  run(p.name, { id: p.id }, p.name === 'addon_publish' ? () => refreshMarket() : undefined)
}
onBeforeUnmount(() => clearTimeout(armTimer))
const rebuilding = computed(() => jobs.value.some(j => j.state === 'done' && j.name.startsWith('addon_') && j.name !== 'addon_publish'))

const busy = ref('')
const error = ref('')
async function toggle(id: string) {
  busy.value = id; error.value = ''
  try { await set(id, !isOn(id)) } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || e?.message
    useToast().toast(`Not changed: ${error.value}`, { tone: 'bad' })
  } finally { busy.value = '' }
}
const ctState = (key?: string) => {
  const id = key && ctId(key)
  const c = id && o.value?.cts?.find((x: any) => x.vmid === id)
  return c ? { text: `CT ${id} ${c.status}`, tone: c.status === 'running' ? 'ok' : 'warn' } : null
}
const names = (ids?: string[]) => (ids ?? []).map(i => list.find(a => a.id === i)?.name ?? i).join(', ')
</script>

<template>
  <div>
    <h2 class="sec">Add-ons <span class="faint small">{{ list.length - (off?.length ?? 0) }} of {{ list.length }} on</span></h2>
    <div v-if="error" class="errbox">{{ error }}</div>
    <div v-if="pending" class="card confirm">
      <p class="small">{{ pending.desc }}</p>
      <div v-if="scan" class="scan small">
        <div v-if="scan.state === 'loading'" class="faint">Safety check: fetching and reading the code…</div>
        <div v-else-if="scan.state === 'error'" class="warn">Safety check failed: {{ scan.error }} (it runs again on Run)</div>
        <template v-else>
          <div>
            <span class="pill" :class="scan.rep.ok ? (scan.rep.count.warn ? 'warn' : 'ok') : 'bad'">
              {{ scan.rep.ok ? (scan.rep.count.warn ? `${scan.rep.count.warn} warning${scan.rep.count.warn === 1 ? '' : 's'}` : 'Safety check passed') : `Blocked: ${scan.rep.count.block} finding${scan.rep.count.block === 1 ? '' : 's'}` }}
            </span>
            <span class="faint"> ClamAV {{ scan.rep.clamav }}</span>
          </div>
          <div v-if="scan.rep.core_block" class="bad">{{ scan.rep.core_block }}</div>
          <ul v-if="shown.length" class="finds">
            <li v-for="(f, i) in shown" :key="i">
              <b :class="f.level === 'block' ? 'bad' : 'warn'">{{ f.rule }}</b> <span class="mono">{{ f.file }}{{ f.line ? `:${f.line}` : '' }}</span> {{ f.why }}
              <div v-if="f.text" class="mono faint snip">{{ f.text }}</div>
            </li>
          </ul>
          <div v-if="notes.length" class="faint">Also: {{ [...new Set(notes.map((f: any) => f.why))].join('; ') }}</div>
          <div v-if="scan.rep.domains?.length" class="faint">Talks to: {{ scan.rep.domains.join(', ') }}</div>
          <div v-if="scan.rep.changed?.length" class="faint">{{ scan.rep.changed.length }} file{{ scan.rep.changed.length === 1 ? '' : 's' }} changed: <span class="mono">{{ scan.rep.changed.slice(0, 12).join(', ') }}{{ scan.rep.changed.length > 12 ? ' …' : '' }}</span></div>
        </template>
      </div>
      <div class="row">
        <button type="button" class="btn primary sm" :disabled="!armed || blocked" @click="go">Run</button>
        <button type="button" class="btn ghost sm" @click="pending = null">Cancel</button>
      </div>
    </div>
    <JobList :jobs="jobs" @dismiss="dismiss" />
    <div v-if="rebuilding" class="small warn">Rebuilding: the dashboard is back in a few minutes; reload then.</div>
    <div class="grid cols-2 list">
      <div v-for="a in list" :key="a.id" class="card" :class="{ dim: !isOn(a.id) }">
        <div class="top">
          <Icon :name="a.icon" :size="18" class="i" />
          <div class="who">
            <b>{{ a.name }}</b>
            <span class="faint small">by {{ a.author }}</span>
          </div>
          <button type="button" class="btn sm" :class="isOn(a.id) ? 'ghost' : 'primary'" :disabled="busy === a.id || off === null" @click="toggle(a.id)">
            {{ isOn(a.id) ? 'Turn off' : 'Turn on' }}
          </button>
        </div>
        <p class="small muted desc">{{ a.desc }}</p>
        <div class="tags">
          <span v-if="a.version" class="pill">v{{ a.version }}</span>
          <span v-if="a.license" class="pill">{{ a.license }}</span>
          <span v-if="a.warning" class="pill warn" :title="a.warning">terms risk</span>
          <button v-if="entry(a.id)?.update" type="button" class="pill accent lnk-pill" @click="ask('addon_update', a.id)">update to v{{ entry(a.id).version }}</button>
          <span v-if="count(entry(a.id)?.installs ?? null)" class="pill">{{ count(entry(a.id).installs) }}</span>
          <span v-if="ctState(a.ct)" class="pill" :class="ctState(a.ct)!.tone">{{ ctState(a.ct)!.text }}</span>
          <span v-for="n in a.needs" :key="n" class="pill">{{ n }}</span>
          <span v-if="a.dependsOn" class="pill accent">needs {{ names(a.dependsOn) }}</span>
          <button v-if="publishable(a.id)" type="button" class="pill accent lnk-pill" @click="ask('addon_publish', a.id)">
            {{ publishable(a.id) === 'new' ? 'Publish' : 'Publish changes' }}
          </button>
          <button v-if="a.version" type="button" class="lnk small rm" @click="ask('addon_remove', a.id)">Remove</button>
        </div>
      </div>
    </div>
    <p class="faint small">Always on: Home, Notes, Chat, Metrics. Turning an add-on off hides it here; its container keeps running.</p>

    <CorePanel class="corep" />

    <h2 class="sec mk">
      <span>Marketplace <span v-if="market?.source === 'local'" class="faint small">offline copy</span></span>
      <button type="button" class="btn ghost sm" :disabled="refreshing" @click="refreshMarket()">{{ refreshing ? 'Checking…' : 'Refresh' }}</button>
    </h2>
    <Skeleton v-if="!market" kind="rows" :n="4" />
    <div v-else-if="!available.length" class="empty-state">Nothing new yet.</div>
    <div v-else class="grid cols-2 list">
      <div v-for="e in available" :key="e.id" class="card">
        <div class="top">
          <Icon :name="e.icon || 'grid'" :size="18" class="i" />
          <div class="who">
            <b>{{ e.name }}</b>
            <span class="faint small">by {{ e.author }}</span>
          </div>
          <button type="button" class="btn primary sm" @click="ask('addon_install', e.id)">Install</button>
        </div>
        <p class="small muted desc">{{ e.desc }}</p>
        <p v-if="e.warning" class="small warn desc">⚠ {{ e.warning }}</p>
        <div class="tags">
          <span class="pill">v{{ e.version }}</span>
          <span v-if="e.license" class="pill">{{ e.license }}</span>
          <span v-if="count(e.installs)" class="pill">{{ count(e.installs) }}</span>
          <span v-for="n in e.needs" :key="n" class="pill">{{ n }}</span>
          <span v-if="e.depends_on?.length" class="pill accent">needs {{ names(e.depends_on) }}</span>
          <span v-if="!coreSatisfies(coreVersion, e.core)" class="pill bad">needs core {{ e.core }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.card.dim { opacity: .55; }
.top { display: flex; align-items: center; gap: 10px; }
.top .i { color: var(--accent); flex: none; }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.desc { margin: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.tags .rm { margin-left: auto; }
.corep { margin-top: 14px; }
.mk { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lnk-pill { cursor: pointer; font: inherit; font-size: 11.5px; }
.confirm { border-color: var(--warn); margin-bottom: 14px; }
.confirm p { margin: 0; }
.row { display: flex; gap: 8px; }
.scan { display: flex; flex-direction: column; gap: 6px; }
.finds { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.snip { overflow-wrap: anywhere; font-size: 11px; }
@media (pointer: coarse) { .tags .rm, .lnk-pill { padding: 6px 10px; } }
</style>
