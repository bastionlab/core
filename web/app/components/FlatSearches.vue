<script setup lang="ts">
const { armed, arm } = useArm()
const props = defineProps<{ searches: any[] }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const TAUSCH = [
  { v: 'exclude', label: 'keine Tauschwohnungen' },
  { v: 'include', label: 'auch Tausch' },
  { v: 'only', label: 'nur Tausch' },
]
const WBS = [
  { v: 'any', label: 'egal' },
  { v: 'without', label: 'nur ohne WBS' },
  { v: 'only', label: 'nur mit WBS' },
]

const blank = () => ({
  name: '', mode: 'city' as 'city' | 'pin', place: 'Berlin', lat: null as number | null, lon: null as number | null,
  radius: '0', minWarm: '', maxWarm: '', minArea: '', maxArea: '', minRooms: '', maxRooms: '',
  tausch: 'exclude', wbs: 'any', allowTemporary: false,
})
/** null = closed, 'new' = adding, a number = editing that search */
const editing = ref<'new' | number | null>(null)
const form = reactive(blank())
const busy = ref('')
const err = ref('')
const note = ref('')

// what the place field resolved to, so the map can show the area before saving
const where = ref<{ label?: string, full?: string, bbox?: [number, number, number, number] | null } | null>(null)
const locating = ref(false)

function openNew() {
  editing.value = editing.value === 'new' ? null : 'new'
  Object.assign(form, blank())
  err.value = ''; where.value = null
  if (editing.value) locate()
}

function openEdit(s: any) {
  if (editing.value === s.id) { editing.value = null; return }
  editing.value = s.id
  err.value = ''
  const sp = s.spec ?? {}
  Object.assign(form, {
    name: s.name,
    mode: sp.mode === 'pin' ? 'pin' : 'city',
    place: sp.mode === 'pin' ? '' : sp.place ?? '',
    lat: sp.mode === 'pin' ? sp.lat : null,
    lon: sp.mode === 'pin' ? sp.lon : null,
    radius: String(sp.radius_km ?? 0),
    minWarm: sp.min_warm ?? '', maxWarm: sp.max_warm ?? '', minArea: sp.min_area ?? '', maxArea: sp.max_area ?? '',
    minRooms: sp.min_rooms ?? '', maxRooms: sp.max_rooms ?? '',
    tausch: sp.tausch ?? 'exclude', wbs: sp.wbs ?? 'any', allowTemporary: !!sp.allow_temporary,
  })
  where.value = { label: sp.place, bbox: sp.bbox ?? null }
}

async function locate() {
  if (form.mode !== 'city' || !form.place.trim()) return
  locating.value = true
  try {
    where.value = await $fetch('/api/flats/geocode', { query: { q: form.place } }) as any
    err.value = ''
  } catch (e: any) {
    where.value = null
    err.value = e?.data?.statusMessage || 'Ort nicht gefunden'
  } finally { locating.value = false }
}

let revTimer: any
function pick(p: { lat: number, lon: number }) {
  form.lat = p.lat
  form.lon = p.lon
  if (form.radius === '0' || !Number(form.radius)) form.radius = '3'
  clearTimeout(revTimer)
  revTimer = setTimeout(async () => {
    try { where.value = await $fetch('/api/flats/geocode', { query: { lat: p.lat, lon: p.lon } }) as any } catch {}
  }, 400)
}

function setMode(m: 'city' | 'pin') {
  if (form.mode === m) return
  form.mode = m
  form.radius = m === 'pin' ? '3' : '0'
  where.value = null
  if (m === 'city') locate()
}

const mapLat = computed(() => form.mode === 'pin' ? form.lat : null)
const mapLon = computed(() => form.mode === 'pin' ? form.lon : null)

async function act(action: string, body: Record<string, any> = {}) {
  busy.value = action + (body.id ?? '')
  err.value = ''
  try {
    const r: any = await $fetch('/api/flats/action', { method: 'POST', body: { action, ...body } })
    emit('changed')
    return r ?? true
  } catch (e: any) {
    err.value = errText(e, 'failed')
    return null
  } finally { busy.value = '' }
}

async function submit() {
  if (form.mode === 'pin' && (form.lat == null || form.lon == null)) { err.value = 'Setz einen Pin auf die Karte.'; return }
  const isNew = editing.value === 'new'
  // in pin mode the city field is stale; the label is whatever the pin resolved to
  const body = { ...form, place: form.mode === 'pin' ? (where.value?.label ?? '') : form.place }
  const r = await act(isNew ? 'add' : 'edit', isNew ? body : { id: editing.value, ...body })
  if (!r) return
  note.value = isNew
    ? `Gespeichert — ${r.added || 0} vorhandene Wohnungen passen schon. Kleinanzeigen wird in den nächsten Minuten durchsucht.`
    : `${r.added || 0} dazu, ${r.removed || 0} raus`
  editing.value = null
  setTimeout(() => (note.value = ''), 9000)
}

const remove = (s: any) => arm(String(s.id)) && act('delete', { id: s.id })

const eur = (v: number) => `${Math.round(v).toLocaleString('de-DE')} €`
function summary(sp: any) {
  const parts: string[] = []
  parts.push(sp.mode === 'pin' ? `📍 ${sp.place} · ${sp.radius_km} km` : `${sp.place}${sp.radius_km ? ` +${sp.radius_km} km` : ''}`)
  if (sp.max_warm) parts.push(`≤ ${eur(sp.max_warm)} warm`)
  if (sp.min_rooms || sp.max_rooms) parts.push(`${sp.min_rooms ?? ''}–${sp.max_rooms ?? ''} Zi.`.replace(/^–/, '≤ ').replace(/–$/, '+'))
  if (sp.min_area || sp.max_area) parts.push(`${sp.min_area ?? ''}–${sp.max_area ?? ''} m²`.replace(/^–/, '≤ ').replace(/– m²$/, '+ m²'))
  if (sp.tausch !== 'exclude') parts.push(TAUSCH.find(t => t.v === sp.tausch)?.label ?? '')
  if (sp.wbs !== 'any') parts.push(WBS.find(t => t.v === sp.wbs)?.label ?? '')
  if (sp.allow_temporary) parts.push('inkl. WG/Zwischenmiete')
  return parts.join(' · ')
}
</script>

<template>
  <Panel title="Suchen">
    <template #actions>
      <button class="btn" @click="openNew">{{ editing === 'new' ? 'Abbrechen' : '+ Neu' }}</button>
    </template>

    <form v-if="editing !== null" class="new" @submit.prevent="submit">
      <div class="row">
        <label>Name<input v-model="form.name" placeholder="2 Zimmer Kreuzberg" required></label>
        <label>Wo?
          <div class="seg">
            <button type="button" :class="{ on: form.mode === 'city' }" @click="setMode('city')">Ort</button>
            <button type="button" :class="{ on: form.mode === 'pin' }" @click="setMode('pin')">📍 Karte</button>
          </div>
        </label>
      </div>

      <div v-if="form.mode === 'city'" class="row">
        <label>Stadt oder Bezirk
          <span class="inl">
            <input v-model="form.place" placeholder="Berlin, Potsdam, Neukölln…" @keydown.enter.prevent="locate" @blur="locate">
            <button class="btn ghost" type="button" :disabled="locating" @click="locate">{{ locating ? '…' : 'Prüfen' }}</button>
          </span>
        </label>
        <label>Zusätzlicher Umkreis km<input v-model="form.radius" type="number" min="0" max="100" step="1"></label>
      </div>
      <div v-else class="row">
        <label>Radius: {{ form.radius }} km
          <input v-model="form.radius" class="slider" type="range" min="0.5" max="30" step="0.5">
        </label>
        <div class="small muted hint2">
          {{ form.lat == null ? 'Klick auf die Karte, um den Mittelpunkt zu setzen.' : `Mittelpunkt: ${where?.label || `${form.lat}, ${form.lon}`}` }}
        </div>
      </div>

      <ClientOnly>
        <MapPick
          :mode="form.mode" :lat="mapLat" :lon="mapLon" :radius="Number(form.radius) || 0"
          :bbox="form.mode === 'city' ? where?.bbox ?? null : null" @pick="pick"
        />
      </ClientOnly>
      <div v-if="form.mode === 'city' && where?.full" class="small muted">Gesucht wird in: {{ where.full }}</div>

      <div class="row narrow">
        <label title="Billiger als das ist meist ein Fake oder nur ein Zimmer">Warmmiete ab €<input v-model="form.minWarm" type="number" min="0" step="10"></label>
        <label title="Angabe im Inserat, sonst Kalt + NK + Heizung; fehlt etwas, wird geschätzt und markiert.">Warmmiete bis €<input v-model="form.maxWarm" type="number" min="0" step="10" placeholder="1200"></label>
        <label>Zimmer ab<input v-model="form.minRooms" type="number" min="0" step="0.5"></label>
        <label>Zimmer bis<input v-model="form.maxRooms" type="number" min="0" step="0.5"></label>
        <label>m² ab<input v-model="form.minArea" type="number" min="0"></label>
        <label>m² bis<input v-model="form.maxArea" type="number" min="0"></label>
      </div>
      <div class="row">
        <label>Tauschwohnung
          <select v-model="form.tausch"><option v-for="o in TAUSCH" :key="o.v" :value="o.v">{{ o.label }}</option></select>
        </label>
        <label>WBS
          <select v-model="form.wbs"><option v-for="o in WBS" :key="o.v" :value="o.v">{{ o.label }}</option></select>
        </label>
      </div>
      <label class="chk"><input v-model="form.allowTemporary" type="checkbox"> WG-Zimmer und Zwischenmiete nicht aussortieren</label>

      <div class="row end">
        <button class="btn ghost" type="button" @click="editing = null">Abbrechen</button>
        <button class="btn primary" :disabled="!!busy">
          {{ busy ? 'Speichert…' : editing === 'new' ? 'Suche anlegen' : 'Speichern' }}
        </button>
      </div>
    </form>

    <div v-if="err" class="small bad pad">{{ err }}</div>
    <div v-if="note" class="small muted pad">{{ note }}</div>

    <div v-if="!props.searches.length && editing === null" class="small muted pad">
      Noch keine Suche.
    </div>
    <div v-for="s in props.searches" :key="s.id" class="row-item" :class="{ editing: editing === s.id, off: !s.enabled }">
      <span class="dot" :class="s.last_error ? 'bad' : s.enabled ? 'ok' : ''" />
      <div class="min" :title="summary(s.spec ?? {})">
        <div class="ell"><b>{{ s.name }}</b><span class="small muted kw">{{ summary(s.spec ?? {}) }}</span></div>
        <div v-if="s.last_error" class="small bad ell">{{ s.last_error }}</div>
      </div>
      <span class="small faint when">{{ s.last_polled_at ? vor(s.last_polled_at) : 'noch nie' }}</span>
      <div class="acts">
        <a v-if="s.url" class="btn ghost ic" :href="s.url" target="_blank" rel="noopener" title="Auf Kleinanzeigen öffnen">↗</a>
        <button class="btn ghost ic" title="Bearbeiten" @click="openEdit(s)">✎</button>
        <button class="btn ghost ic" :disabled="!!busy" :title="s.enabled ? 'Pausieren' : 'Weiter'" @click="act(s.enabled ? 'disable' : 'enable', { id: s.id })">{{ s.enabled ? '❙❙' : '▶' }}</button>
        <button class="btn ghost ic danger" :disabled="!!busy" :class="{ sure: armed === String(s.id) }" :title="armed === String(s.id) ? 'Suche und Treffer löschen' : 'Löschen'" @click="remove(s)">{{ armed === String(s.id) ? 'Sicher?' : '✕' }}</button>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.new { display: flex; flex-direction: column; gap: 8px; padding: 10px; margin-bottom: 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 9px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
.row.narrow { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.row.end { display: flex; align-items: center; gap: 10px; }
.row.end .btn:first-of-type { margin-left: auto; }
label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); min-width: 0; }
label.chk { flex-direction: row; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
.new input, .new select, .new textarea { background: var(--panel); border: 1px solid var(--line-2); border-radius: 6px; padding: 5px 8px; color: var(--text); font: inherit; font-size: 13px; min-width: 0; }
.slider { padding: 0; accent-color: var(--accent); }
.inl { display: flex; gap: 6px; }
.inl input { flex: 1; }
.hint2 { padding-bottom: 6px; }
.seg { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--panel); }
.seg button { flex: 1; padding: 5px 10px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; }
.seg button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.row-item { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
.row-item.off { opacity: .6; }
.kw { margin-left: 8px; }
.acts { display: flex; flex: none; }
.ic { width: 30px; height: 30px; padding: 0; font-size: 13px; }
.row-item + .row-item { border-top: 1px solid var(--line); }
.row-item.editing { background: var(--accent-soft); border-radius: 7px; padding-inline: 8px; }
.min { flex: 1; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pad { padding: 6px 0; }
@media (max-width: 700px) {
  .row { grid-template-columns: 1fr; }
  .row.narrow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .row.end { flex-wrap: wrap; }
  .when { display: none; }
  .new input, .new select, .new textarea { font-size: 16px; }
}
</style>
