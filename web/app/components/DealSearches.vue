<script setup lang="ts">
const props = defineProps<{ searches: any[], selected: number | null }>()
const emit = defineEmits<{ (e: 'select', id: number | null): void, (e: 'changed'): void }>()

const open = ref(false)
const busy = ref('')
const err = ref('')
const form = reactive({ name: '', keyword: '', terms: '', exclude: '', minPrice: '', maxPrice: '', radius: '10', shipping: 'any' })

async function act(action: string, body: Record<string, any> = {}) {
  busy.value = action + (body.id ?? '')
  err.value = ''
  try {
    await $fetch('/api/deals/action', { method: 'POST', body: { action, ...body } })
    emit('changed')
    return true
  } catch (e: any) {
    err.value = e?.statusMessage || e?.message || 'failed'
    return false
  } finally { busy.value = '' }
}

async function add() {
  if (await act('add', { ...form })) {
    open.value = false
    Object.assign(form, { name: '', keyword: '', terms: '', exclude: '', minPrice: '', maxPrice: '', radius: '10', shipping: 'any' })
  }
}
const remove = (s: any) => confirm(`Delete "${s.name}" and its matches?`) && act('delete', { id: s.id })
</script>

<template>
  <Panel title="Searches" :sub="`${searches.length} saved`">
    <template #actions>
      <button class="btn" @click="open = !open">{{ open ? 'Cancel' : '+ New search' }}</button>
    </template>

    <form v-if="open" class="new" @submit.prevent="add">
      <div class="row">
        <label>Name<input v-model="form.name" placeholder="rennrad" required></label>
        <label>Search words<input v-model="form.keyword" placeholder="Rennrad Carbon" required></label>
      </div>
      <div class="row">
        <label>Must contain one of<input v-model="form.terms" placeholder="rennrad, gravel (blank = the search words)"></label>
        <label>Never contain<input v-model="form.exclude" placeholder="kinder, defekt, rahmen"></label>
      </div>
      <div class="row narrow">
        <label>Min €<input v-model="form.minPrice" type="number" min="0"></label>
        <label>Max €<input v-model="form.maxPrice" type="number" min="0"></label>
        <label>Radius km<input v-model="form.radius" type="number" min="0" max="200"></label>
        <label>Shipping<select v-model="form.shipping"><option value="any">any</option><option value="only">shippable only</option></select></label>
      </div>
      <div class="row end">
        <span class="small muted">First poll only seeds — you get pushes from the next one on.</span>
        <button class="btn primary" :disabled="busy === 'add'">{{ busy === 'add' ? 'Adding…' : 'Add search' }}</button>
      </div>
    </form>

    <div v-if="err" class="small bad pad">{{ err }}</div>

    <div class="chips">
      <button class="chip" :class="{ on: selected === null }" @click="emit('select', null)">All</button>
      <button
        v-for="s in searches" :key="s.id" class="chip"
        :class="{ on: selected === s.id, off: !s.enabled }"
        @click="emit('select', s.id)"
      >{{ s.name }} <span class="muted">{{ s.hits }}</span></button>
    </div>

    <div v-for="s in searches" :key="'r' + s.id" class="row-item">
      <span class="dot" :class="s.last_error ? 'bad' : s.enabled ? 'ok' : ''" />
      <div class="min">
        <b>{{ s.name }}</b>
        <div class="small muted ell">{{ s.spec?.keyword }}<template v-if="s.spec?.exclude?.length"> · not: {{ s.spec.exclude.join(', ') }}</template></div>
        <div v-if="s.last_error" class="small bad">{{ s.last_error }}</div>
      </div>
      <span class="small muted">{{ s.last_polled_at ? ago(s.last_polled_at) : 'never' }}</span>
      <a class="btn ghost" :href="s.url" target="_blank" rel="noopener" title="Open this search on Kleinanzeigen">↗</a>
      <button class="btn ghost" :disabled="!!busy" @click="act(s.enabled ? 'disable' : 'enable', { id: s.id })">{{ s.enabled ? 'Pause' : 'Resume' }}</button>
      <button class="btn ghost danger" :disabled="!!busy" @click="remove(s)">✕</button>
    </div>
  </Panel>
</template>

<style scoped>
.new { display: flex; flex-direction: column; gap: 8px; padding: 10px; margin-bottom: 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 9px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.row.narrow { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.row.end { display: flex; align-items: center; gap: 10px; }
.row.end .btn { margin-left: auto; }
label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); min-width: 0; }
input, select { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; color: var(--text); font: inherit; font-size: 13px; min-width: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; }
.chip.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.chip.off { opacity: .5; text-decoration: line-through; }
.row-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.row-item + .row-item { border-top: 1px solid var(--line); }
.min { flex: 1; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pad { padding: 6px 0; }
@media (max-width: 700px) { .row, .row.narrow { grid-template-columns: 1fr 1fr; } }
</style>
