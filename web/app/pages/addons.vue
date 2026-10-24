<script setup lang="ts">
/** phase 1 of the marketplace: every add-on of this dashboard, who built it, what it needs, on/off */
useHead({ title: 'Add-ons · pve' })
const { list, off, load, isOn, set } = useAddons()
const { data: o } = useOverview()
const { ctId } = useDashConfig()
onMounted(load)

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
          <span v-if="ctState(a.ct)" class="pill" :class="ctState(a.ct)!.tone">{{ ctState(a.ct)!.text }}</span>
          <span v-for="n in a.needs" :key="n" class="pill">{{ n }}</span>
          <span v-if="a.dependsOn" class="pill accent">needs {{ names(a.dependsOn) }}</span>
        </div>
      </div>
    </div>
    <p class="faint small">Always on: Home, Notes, Chat, Metrics. Turning an add-on off hides it here; its container keeps running.</p>
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
