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
          <span v-if="entry(a.id)?.update" class="pill accent">update: v{{ entry(a.id).version }}</span>
          <span v-if="count(entry(a.id)?.installs ?? null)" class="pill">{{ count(entry(a.id).installs) }}</span>
          <span v-if="ctState(a.ct)" class="pill" :class="ctState(a.ct)!.tone">{{ ctState(a.ct)!.text }}</span>
          <span v-for="n in a.needs" :key="n" class="pill">{{ n }}</span>
          <span v-if="a.dependsOn" class="pill accent">needs {{ names(a.dependsOn) }}</span>
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
.tags { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
