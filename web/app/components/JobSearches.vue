<script setup lang="ts">
const { armed, arm } = useArm()
const props = defineProps<{ searches: any[], sources: { id: string, label: string }[], hasCv: boolean }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const MODES = [
  { v: 'onsite', label: 'Vor Ort' },
  { v: 'hybrid', label: 'Hybrid' },
  { v: 'remote', label: 'Remote' },
]
const EMPLOYMENT = [
  { v: 'vollzeit', label: 'Vollzeit' }, { v: 'teilzeit', label: 'Teilzeit' }, { v: 'werkstudent', label: 'Werkstudent' },
  { v: 'praktikum', label: 'Praktikum' }, { v: 'ausbildung', label: 'Ausbildung' }, { v: 'freelance', label: 'Freelance' },
  { v: 'minijob', label: 'Minijob' },
]
const LEVELS = [
  { v: 'junior', label: 'Junior' }, { v: 'mid', label: 'Mid' }, { v: 'senior', label: 'Senior' }, { v: 'lead', label: 'Lead' },
]
const LANGS = [{ v: 'de', label: 'Deutsch' }, { v: 'en', label: 'Englisch' }]

const blank = () => ({
  name: '', wish: '', keywords: '', modes: ['onsite', 'hybrid', 'remote'] as string[], place: 'Berlin', radius: '25',
  employment: [] as string[], permanentOnly: false, levels: [] as string[], minSalary: '', langs: [] as string[],
  noAgency: true, exclude: '', excludeCompanies: '', maxAge: '14', minFit: '60', sources: [] as string[],
})
/** null = closed, 'new' = adding, a number = editing that search */
const editing = ref<'new' | number | null>(null)
const form = reactive(blank())
const more = ref(false)
const busy = ref('')
const err = ref('')
const note = ref('')
const hint = ref('')

const local = computed(() => form.modes.includes('onsite') || form.modes.includes('hybrid'))

function openNew() {
  editing.value = editing.value === 'new' ? null : 'new'
  Object.assign(form, blank())
  err.value = ''; hint.value = ''; more.value = false
}

function openEdit(s: any) {
  if (editing.value === s.id) { editing.value = null; return }
  editing.value = s.id
  err.value = ''; hint.value = ''
  const sp = s.spec ?? {}
  Object.assign(form, {
    name: s.name, wish: sp.wish ?? '', keywords: (sp.keywords ?? []).join(', '),
    modes: [...(sp.modes ?? [])], place: sp.place ?? '', radius: String(sp.radius_km ?? 25),
    employment: [...(sp.employment ?? [])], permanentOnly: !!sp.permanent_only, levels: [...(sp.levels ?? [])],
    minSalary: sp.min_salary ?? '', langs: [...(sp.langs ?? [])], noAgency: sp.no_agency !== false,
    exclude: (sp.exclude ?? []).join(', '), excludeCompanies: (sp.exclude_companies ?? []).join(', '),
    maxAge: String(sp.max_age_days ?? 14), minFit: String(sp.min_fit ?? 60), sources: [...(sp.sources ?? [])],
  })
  more.value = !!(form.exclude || form.excludeCompanies || form.sources.length)
}

function toggle(list: string[], v: string) {
  const i = list.indexOf(v)
  if (i >= 0) list.splice(i, 1)
  else list.push(v)
}

async function act(action: string, body: Record<string, any> = {}) {
  busy.value = action + (body.id ?? '')
  err.value = ''
  try {
    const r: any = await $fetch('/api/jobs/action', { method: 'POST', body: { action, ...body } })
    if (action !== 'suggest') emit('changed')
    return r ?? true
  } catch (e: any) {
    err.value = e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed'
    return null
  } finally { busy.value = '' }
}

async function suggest() {
  const r = await act('suggest', { wish: form.wish })
  if (!r) return
  form.keywords = (r.keywords ?? []).join(', ')
  if (!form.levels.length && r.level?.length) form.levels = [...r.level]
  hint.value = r.note ?? ''
}

async function submit() {
  if (!form.modes.length) { err.value = 'Mindestens ein Arbeitsmodell wählen'; return }
  const isNew = editing.value === 'new'
  const r = await act(isNew ? 'add' : 'edit', isNew ? { ...form } : { id: editing.value, ...form })
  if (!r) return
  note.value = isNew
    ? `Gespeichert · Suchbegriffe: ${(r.spec?.keywords ?? []).join(', ')}. Die Portale werden in den nächsten Minuten durchsucht.`
    : ['Gespeichert · sofort neu sortiert',
       r.rejudge ? `${r.rejudge} Treffer warten auf die KI` : '',
       r.repoll ? 'Portale werden neu durchsucht' : ''].filter(Boolean).join(' · ')
  editing.value = null
  setTimeout(() => (note.value = ''), 12000)
}

const remove = (s: any) => arm(String(s.id)) && act('delete', { id: s.id })

const eur = (v: number) => `${Math.round(v).toLocaleString('de-DE')} €`
function summary(sp: any) {
  const parts: string[] = [(sp.keywords ?? []).join(' / ')]
  const m = (sp.modes ?? []).map((x: string) => MODES.find(o => o.v === x)?.label).filter(Boolean)
  if (m.length < 3) parts.push(m.join('/'))
  if (sp.place && (sp.modes ?? []).some((x: string) => x !== 'remote')) parts.push(`${sp.place} +${sp.radius_km} km`)
  if (sp.levels?.length) parts.push(sp.levels.map((l: string) => LEVELS.find(o => o.v === l)?.label).join('/'))
  if (sp.employment?.length) parts.push(sp.employment.map((l: string) => EMPLOYMENT.find(o => o.v === l)?.label).join('/'))
  if (sp.min_salary) parts.push(`≥ ${eur(sp.min_salary)}`)
  parts.push(`Match ≥ ${sp.min_fit}`)
  return parts.filter(Boolean).join(' · ')
}
</script>

<template>
  <Panel title="Suchen">
    <template #actions>
      <button class="btn" @click.stop="openNew">{{ editing === 'new' ? 'Abbrechen' : '+ Neu' }}</button>
    </template>

    <form v-if="editing !== null" class="new" @submit.prevent="submit">
      <label>Name<input v-model="form.name" placeholder="Backend Berlin" required maxlength="48"></label>
      <label>Was suchst du?
        <textarea
          v-model="form.wish" rows="3"
          placeholder="z.B. Backend mit Python oder Go, gerne Fintech oder Klima, kein Consulting, kleines Team, max. 2 Tage Büro"
        />
      </label>
      <label>Suchbegriffe für die Portale
        <span class="inl">
          <input v-model="form.keywords" placeholder="leer = aus Wunsch und Lebenslauf ableiten">
          <button class="btn ghost" type="button" :disabled="!!busy || (!form.wish.trim() && !hasCv)" title="aus Wunsch und Lebenslauf vorschlagen" @click="suggest">
            {{ busy === 'suggest' ? '…' : '✦ Vorschlagen' }}
          </button>
        </span>
      </label>
      <div v-if="hint" class="small muted">✦ {{ hint }}</div>

      <div class="grp">
        <span class="lbl">Arbeitsmodell</span>
        <button v-for="o in MODES" :key="o.v" type="button" class="chip" :class="{ on: form.modes.includes(o.v) }" @click="toggle(form.modes, o.v)">{{ o.label }}</button>
      </div>
      <div v-if="local" class="row">
        <label>Ort (für Vor Ort / Hybrid)<input v-model="form.place" placeholder="Berlin, Potsdam, Leipzig…"></label>
        <label>Umkreis km<input v-model="form.radius" type="number" min="0" max="200" step="5"></label>
      </div>

      <div class="grp">
        <span class="lbl">Anstellung</span>
        <button v-for="o in EMPLOYMENT" :key="o.v" type="button" class="chip" :class="{ on: form.employment.includes(o.v) }" @click="toggle(form.employment, o.v)">{{ o.label }}</button>
        <span class="faint small">{{ form.employment.length ? '' : 'alle' }}</span>
      </div>
      <div class="grp">
        <span class="lbl">Level</span>
        <button v-for="o in LEVELS" :key="o.v" type="button" class="chip" :class="{ on: form.levels.includes(o.v) }" @click="toggle(form.levels, o.v)">{{ o.label }}</button>
        <span class="faint small">{{ form.levels.length ? '' : 'alle' }}</span>
      </div>
      <div class="grp">
        <span class="lbl">Sprache der Anzeige</span>
        <button v-for="o in LANGS" :key="o.v" type="button" class="chip" :class="{ on: form.langs.includes(o.v) }" @click="toggle(form.langs, o.v)">{{ o.label }}</button>
        <span class="faint small">{{ form.langs.length ? '' : 'beide' }}</span>
      </div>

      <div class="row three">
        <label title="Stellen ohne Gehaltsangabe bleiben drin">Gehalt ab €/Jahr<input v-model="form.minSalary" type="number" min="0" step="1000" placeholder="60000"></label>
        <label>Nicht älter als (Tage)<input v-model="form.maxAge" type="number" min="1" max="60"></label>
        <label title="0–100: wie gut die Stelle laut KI zu Lebenslauf und Wunsch passt; darunter = aussortiert">Mindest-Match: {{ form.minFit }}
          <input v-model="form.minFit" class="slider" type="range" min="0" max="95" step="5">
        </label>
      </div>
      <label class="chk"><input v-model="form.noAgency" type="checkbox"> Personalvermittlung &amp; Zeitarbeit aussortieren</label>
      <label class="chk"><input v-model="form.permanentOnly" type="checkbox"> nur unbefristet</label>

      <button type="button" class="btn ghost more" @click="more = !more">{{ more ? '▾' : '▸' }} Ausschlüsse &amp; Portale</button>
      <template v-if="more">
        <div class="row">
          <label>Nicht im Titel (Komma)<input v-model="form.exclude" placeholder="Werkstudent, SAP, Vertrieb"></label>
          <label>Firmen ausschließen (Komma)<input v-model="form.excludeCompanies" placeholder="Firma A, Firma B"></label>
        </div>
        <div class="grp">
          <span class="lbl">Portale</span>
          <button v-for="o in sources" :key="o.id" type="button" class="chip" :class="{ on: form.sources.includes(o.id) }" @click="toggle(form.sources, o.id)">{{ o.label }}</button>
          <span class="faint small">{{ form.sources.length ? '' : 'alle' }}</span>
        </div>
      </template>

      <div class="end">
        <button class="btn ghost" type="button" @click="editing = null">Abbrechen</button>
        <button class="btn primary" :disabled="!!busy">
          {{ busy === 'add' || busy.startsWith('edit') ? 'Speichert…' : editing === 'new' ? 'Suche anlegen' : 'Speichern' }}
        </button>
      </div>
    </form>

    <div v-if="err" class="small bad pad">{{ err }}</div>
    <div v-if="note" class="small muted pad">{{ note }}</div>

    <div v-if="!props.searches.length && editing === null" class="small muted pad">Noch keine Suche.</div>
    <div v-for="s in props.searches" :key="s.id" class="row-item" :class="{ editing: editing === s.id, off: !s.enabled }">
      <span class="dot" :class="s.last_error ? 'warn' : s.enabled ? 'ok' : ''" />
      <div class="min" :title="(s.spec?.wish ? s.spec.wish + '\n\n' : '') + summary(s.spec ?? {})">
        <div class="ell"><b>{{ s.name }}</b><span class="small muted kw">{{ summary(s.spec ?? {}) }}</span></div>
        <div v-if="s.last_error" class="small warn ell" :title="s.last_error">{{ s.last_error }}</div>
      </div>
      <span class="small faint when">{{ s.last_polled_at ? ago(s.last_polled_at) : 'gleich' }}</span>
      <div class="acts">
        <button class="btn ghost ic" :disabled="!!busy || !s.enabled" title="Jetzt suchen" @click="act('run', { id: s.id })">⟳</button>
        <button class="btn ghost ic" title="Bearbeiten" @click="openEdit(s)">✎</button>
        <button class="btn ghost ic" :disabled="!!busy" :title="s.enabled ? 'Pausieren' : 'Weiter'" @click="act(s.enabled ? 'disable' : 'enable', { id: s.id })">{{ s.enabled ? '❙❙' : '▶' }}</button>
        <button class="btn ghost ic danger" :disabled="!!busy" :class="{ sure: armed === String(s.id) }" :title="armed === String(s.id) ? 'Suche und Treffer löschen' : 'Löschen'" @click="remove(s)">{{ armed === String(s.id) ? 'Sicher?' : '✕' }}</button>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.new { display: flex; flex-direction: column; gap: 9px; padding: 10px; margin-bottom: 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 9px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
.row.three { grid-template-columns: 1fr 1fr 1.2fr; }
.end { display: flex; justify-content: flex-end; gap: 10px; }
label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); min-width: 0; }
label.chk { flex-direction: row; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
.new input, .new select, .new textarea { background: var(--panel); border: 1px solid var(--line-2); border-radius: 6px; padding: 5px 8px; color: var(--text); font: inherit; font-size: 13px; min-width: 0; }
.new textarea { resize: vertical; line-height: 1.4; }
.slider { padding: 0 !important; accent-color: var(--accent); }
.inl { display: flex; gap: 6px; }
.inl input { flex: 1; }
.grp { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.lbl { font-size: 11.5px; color: var(--muted); width: 130px; flex: none; }
.chip { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.chip.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.more { align-self: flex-start; padding: 2px 6px; font-size: 12px; }
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
  .row, .row.three { grid-template-columns: 1fr; }
  .lbl { width: 100%; }
  .when { display: none; }
  .new input, .new select, .new textarea { font-size: 16px; }
}
</style>
