<script setup lang="ts">
/** every add-on of this dashboard (who built it, what it needs, on/off) and the marketplace of ones not installed yet */
useHead({ title: 'Add-ons · pve' })
const { list, off, load, isOn, set } = useAddons()
const { data: o } = useOverview()
const { ctId } = useDashConfig()
onMounted(load)

// marketplace index (server/utils/marketplace.ts): Update badges here, the not-installed ones below
const { data: market } = useFetch<any>('/api/marketplace', { server: false })
const entry = (id: string) => market.value?.addons?.find((e: any) => e.id === id)
const available = computed(() => (market.value?.addons ?? []).filter((e: any) => !e.installed))
const count = (n: number | null) => (n == null ? '' : `${n} install${n === 1 ? '' : 's'}`)

// install / update / remove: the agent describes exactly what will happen, Run arms after a moment
// (third-party code, root on pve), then deploy.sh rebuilds the app in its own unit
const { jobs, run, dismiss } = useActions()
const pending = ref<{ name: string, id: string, desc: string } | null>(null)
const armed = ref(false)
let armTimer: any
async function ask(name: string, id: string) {
  error.value = ''
  try {
    const r = await $fetch<{ desc: string }>('/api/ai/action/check', { method: 'POST', body: { name, args: { id } } })
    pending.value = { name, id, desc: r.desc }
    armed.value = false
    clearTimeout(armTimer)
    armTimer = setTimeout(() => (armed.value = true), 1500)
  } catch (e: any) { error.value = e?.data?.statusMessage || e?.statusMessage || e?.message }
}
function go() {
  const p = pending.value
  if (!p || !armed.value) return
  pending.value = null
  run(p.name, { id: p.id })
}
onBeforeUnmount(() => clearTimeout(armTimer))
const rebuilding = computed(() => jobs.value.some(j => j.state === 'done' && j.name.startsWith('addon_')))

const busy = ref('')
const error = ref('')
async function toggle(id: string) {
  busy.value = id; error.value = ''
  try { await set(id, !isOn(id)) } catch (e: any) { error.value = e?.data?.statusMessage || e?.statusMessage || e?.message } finally { busy.value = '' }
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
      <div class="row">
        <button type="button" class="btn primary sm" :disabled="!armed" @click="go">Run</button>
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
          <button v-if="entry(a.id)?.update" type="button" class="pill accent lnk-pill" @click="ask('addon_update', a.id)">update to v{{ entry(a.id).version }}</button>
          <span v-if="count(entry(a.id)?.installs ?? null)" class="pill">{{ count(entry(a.id).installs) }}</span>
          <span v-if="ctState(a.ct)" class="pill" :class="ctState(a.ct)!.tone">{{ ctState(a.ct)!.text }}</span>
          <span v-for="n in a.needs" :key="n" class="pill">{{ n }}</span>
          <span v-if="a.dependsOn" class="pill accent">needs {{ names(a.dependsOn) }}</span>
          <button v-if="a.version" type="button" class="lnk small rm" @click="ask('addon_remove', a.id)">Remove</button>
        </div>
      </div>
    </div>
    <p class="faint small">Always on: Home, Notes, Chat, Metrics. Turning an add-on off hides it here; its container keeps running.</p>

    <h2 class="sec">Marketplace <span v-if="market?.source === 'local'" class="faint small">offline copy</span></h2>
    <div v-if="!market" class="faint small">Loading…</div>
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
        <div class="tags">
          <span class="pill">v{{ e.version }}</span>
          <span v-if="count(e.installs)" class="pill">{{ count(e.installs) }}</span>
          <span v-for="n in e.needs" :key="n" class="pill">{{ n }}</span>
          <span v-if="e.depends_on?.length" class="pill accent">needs {{ names(e.depends_on) }}</span>
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
.lnk-pill { cursor: pointer; font: inherit; font-size: 11.5px; }
.confirm { border-color: var(--warn); margin-bottom: 14px; }
.confirm p { margin: 0; }
.row { display: flex; gap: 8px; }
@media (pointer: coarse) { .tags .rm, .lnk-pill { padding: 6px 10px; } }
</style>
