<script setup lang="ts">
const props = defineProps<{ searches: any[] }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const SHIPPING = [
  { v: 'any', label: 'egal' },
  { v: 'pickup', label: 'nur Abholen' },
  { v: 'ship', label: 'nur Versand' },
]

const blank = () => ({ name: '', keyword: '', terms: '', exclude: '', minPrice: '', maxPrice: '', radius: '10', shipping: 'any' })
/** null = closed, 'new' = adding, a number = editing that search */
const editing = ref<'new' | number | null>(null)
const form = reactive(blank())
const busy = ref('')
const err = ref('')

function openNew() {
  editing.value = editing.value === 'new' ? null : 'new'
  Object.assign(form, blank())
  err.value = ''
}

function openEdit(s: any) {
  if (editing.value === s.id) { editing.value = null; return }
  editing.value = s.id
  err.value = ''
  const sp = s.spec ?? {}
  Object.assign(form, {
    name: s.name,
    keyword: sp.keyword ?? '',
    terms: (sp.terms ?? []).join(', '),
    exclude: (sp.exclude ?? []).join(', '),
    minPrice: sp.min_price ?? '',
    maxPrice: sp.max_price ?? '',
    radius: String(sp.radius_km ?? 10),
    // "only" is the old spelling of "ship"
    shipping: sp.shipping === 'only' ? 'ship' : (sp.shipping ?? 'any'),
  })
}

async function act(action: string, body: Record<string, any> = {}) {
  busy.value = action + (body.id ?? '')
  err.value = ''
  try {
    const r: any = await $fetch('/api/deals/action', { method: 'POST', body: { action, ...body } })
    emit('changed')
    return r ?? true
  } catch (e: any) {
    err.value = e?.statusMessage || e?.message || 'failed'
    return null
  } finally { busy.value = '' }
}

const note = ref('')
async function submit() {
  const isNew = editing.value === 'new'
  const r = await act(isNew ? 'add' : 'edit', isNew ? { ...form } : { id: editing.value, ...form })
  if (!r) return
  // say what the edit did to the feed, since it can remove listings you were looking at
  note.value = isNew
    ? ''
    : `${r.added || 0} added, ${r.removed || 0} removed from the feed`
  editing.value = null
  setTimeout(() => (note.value = ''), 6000)
}

const remove = (s: any) => confirm(`Delete "${s.name}" and its matches?`) && act('delete', { id: s.id })
const shipLabel = (sp: any) => SHIPPING.find(x => x.v === (sp?.shipping === 'only' ? 'ship' : sp?.shipping))?.label
</script>

<template>
  <Panel title="Searches" :sub="`${props.searches.length} saved`">
    <template #actions>
      <button class="btn" @click="openNew">{{ editing === 'new' ? 'Cancel' : '+ New search' }}</button>
    </template>

    <form v-if="editing !== null" class="new" @submit.prevent="submit">
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
        <label>Abholen / Versand
          <select v-model="form.shipping">
            <option v-for="o in SHIPPING" :key="o.v" :value="o.v">{{ o.label }}</option>
          </select>
        </label>
      </div>
      <div class="row end">
        <span class="small muted">
          <template v-if="editing === 'new'">First poll only seeds — you get pushes from the next one on.</template>
          <template v-else>Saving re-checks listings you already have. It never sends notifications.</template>
        </span>
        <button class="btn ghost" type="button" @click="editing = null">Cancel</button>
        <button class="btn primary" :disabled="!!busy">
          {{ busy ? 'Saving…' : editing === 'new' ? 'Add search' : 'Save changes' }}
        </button>
      </div>
    </form>

    <div v-if="err" class="small bad pad">{{ err }}</div>
    <div v-if="note" class="small muted pad">{{ note }}</div>

    <div v-for="s in props.searches" :key="s.id" class="row-item" :class="{ editing: editing === s.id }">
      <span class="dot" :class="s.last_error ? 'bad' : s.enabled ? 'ok' : ''" />
      <div class="min">
        <b>{{ s.name }}</b>
        <div class="small muted ell">
          {{ s.spec?.keyword }}
          <template v-if="s.spec?.exclude?.length"> · not: {{ s.spec.exclude.join(', ') }}</template>
          <template v-if="s.spec?.shipping && s.spec.shipping !== 'any'"> · {{ shipLabel(s.spec) }}</template>
        </div>
        <div v-if="s.last_error" class="small bad">{{ s.last_error }}</div>
      </div>
      <span class="small muted when">{{ s.last_polled_at ? ago(s.last_polled_at) : 'never' }}</span>
      <a class="btn ghost" :href="s.url" target="_blank" rel="noopener" title="Open this search on Kleinanzeigen">↗</a>
      <button class="btn ghost" title="Edit" @click="openEdit(s)">✎</button>
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
.row.end .btn:first-of-type { margin-left: auto; }
label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); min-width: 0; }
input, select { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; color: var(--text); font: inherit; font-size: 13px; min-width: 0; }
.row-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.row-item + .row-item { border-top: 1px solid var(--line); }
.row-item.editing { background: var(--accent-soft); border-radius: 7px; padding-inline: 8px; }
.min { flex: 1; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pad { padding: 6px 0; }
@media (max-width: 700px) {
  .row, .row.narrow { grid-template-columns: 1fr 1fr; }
  .when { display: none; }
}
</style>
