<script setup lang="ts">
const { armed, arm } = useArm()
const props = defineProps<{ searches: any[] }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const SHIPPING = [
  { v: 'any', label: 'egal' },
  { v: 'pickup', label: 'nur Abholen' },
  { v: 'ship', label: 'nur Versand' },
]

// minScore / locationId have no field here (CLI-only) but must survive an edit, or the backend falls back to its defaults
const blank = () => ({ name: '', keyword: '', terms: '', exclude: '', minPrice: '', maxPrice: '', radius: '10', shipping: 'any', intent: '', minScore: '' as number | '', locationId: '' })
/** null = closed, 'new' = adding, a number = editing that search */
const editing = ref<'new' | number | null>(null)
const form = reactive(blank())
const busy = ref('')
const err = ref('')

function openNew() {
  editing.value = editing.value === 'new' ? null : 'new'
  Object.assign(form, blank())
  err.value = ''; wish.value = ''; composed.value = ''; steps.value = []; preview.value = []
}

function openEdit(s: any) {
  if (editing.value === s.id) { editing.value = null; return }
  editing.value = s.id
  err.value = ''; wish.value = ''; composed.value = ''; steps.value = []; preview.value = []
  const sp = s.spec ?? {}
  Object.assign(form, {
    name: s.name,
    keyword: sp.keyword ?? '',
    terms: (sp.terms ?? []).join(', '),
    exclude: (sp.exclude ?? []).join(', '),
    minPrice: sp.min_price ?? '',
    maxPrice: sp.max_price ?? '',
    radius: String(sp.radius_km ?? 10),
    intent: sp.intent ?? '',
    // "only" is the old spelling of "ship"
    shipping: sp.shipping === 'only' ? 'ship' : (sp.shipping ?? 'any'),
    minScore: sp.min_score ?? '',
    locationId: sp.location_id ?? '',
  })
}

async function act(action: string, body: Record<string, any> = {}) {
  busy.value = action + (body.id ?? '')
  err.value = ''
  try {
    const r: any = await $fetch('/api/deals/action', { method: 'POST', body: { action, ...body } })
    if (action === 'rejudge' && r) {
      note.value = `KI: ${r.passed} behalten, ${r.filtered} aussortiert`
      setTimeout(() => (note.value = ''), 8000)
    }
    emit('changed')
    return r ?? true
  } catch (e: any) {
    err.value = errText(e, 'failed')
    return null
  } finally { busy.value = '' }
}

const note = ref('')

// --- ask the local model to fill the form ---------------------------------
const wish = ref('')
const composing = ref(false)
const composed = ref('')

const steps = ref<{ text: string, tone?: string }[]>([])
const preview = ref<any[]>([])

function apply(f: any) {
  const keepName = form.name
  Object.assign(form, {
    name: keepName || f.name,
    keyword: f.keyword,
    terms: (f.terms ?? []).join(', '),
    exclude: (f.exclude ?? []).join(', '),
    minPrice: f.minPrice ?? '',
    maxPrice: f.maxPrice ?? '',
    radius: String(f.radius ?? 10),
    shipping: f.shipping ?? 'any',
    intent: f.intent ?? '',
  })
}

/** The loop drafts a filter, runs it on Kleinanzeigen, compares the real hits
 *  against what you asked for, and corrects itself. Streamed, because it takes
 *  a while and watching it reason is most of the reassurance. */
async function compose() {
  if (!wish.value.trim() || composing.value) return
  composing.value = true
  err.value = ''
  composed.value = ''
  steps.value = []
  preview.value = []
  try {
    const res = await fetch('/api/deals/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: wish.value }),
    })
    if (!res.ok || !res.body) throw new Error(`compose failed (${res.status})`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const e = JSON.parse(line)
        if (e.step === 'drafted') { apply(e.form); steps.value.push({ text: `Entwurf: „${e.form.keyword}"` }) }
        else if (e.step === 'probing') steps.value.push({ text: `Testlauf ${e.round} auf Kleinanzeigen…` })
        else if (e.step === 'probed') {
          const last = steps.value[steps.value.length - 1]
          if (last) last.text = `Testlauf ${e.round}: ${e.found} Anzeigen, ${e.kept} passen`
        }
        else if (e.step === 'checking') steps.value.push({ text: 'Abgleich mit deiner Beschreibung…' })
        else if (e.step === 'verdict') {
          const last = steps.value[steps.value.length - 1]
          const tone = e.ok === true ? 'ok' : e.ok === false ? 'warn' : ''
          if (last) { last.text = e.problem || (e.ok ? 'Passt.' : 'Wird nachgebessert.'); last.tone = tone }
          if (e.changed?.length) steps.value.push({ text: `Angepasst: ${e.changed.join(', ')}`, tone: 'warn' })
        }
        else if (e.step === 'done') {
          apply(e.form)
          preview.value = e.preview ?? []
          composed.value = e.form.note || ''
        }
        else if (e.step === 'reverted') steps.value.push({ text: e.problem, tone: 'ok' })
        else if (e.step === 'error') err.value = e.message
      }
    }
  } catch (e: any) {
    err.value = e?.message || 'das Modell ist nicht erreichbar'
  } finally { composing.value = false }
}

async function submit() {
  const isNew = editing.value === 'new'
  const r = await act(isNew ? 'add' : 'edit', isNew ? { ...form } : { id: editing.value, ...form })
  if (!r) return
  // say what the edit did to the feed, since it can remove listings you were looking at
  note.value = isNew
    ? ''
    : `${r.added || 0} neu im Feed, ${r.removed || 0} entfernt`
  editing.value = null
  setTimeout(() => (note.value = ''), 6000)
}

const remove = (s: any) => arm(String(s.id)) && act('delete', { id: s.id })
/** everything that used to be spelled out under the row */
function tip(s: any) {
  const sp = s.spec ?? {}
  return [
    sp.keyword,
    sp.exclude?.length && `ohne: ${sp.exclude.join(', ')}`,
    sp.shipping && sp.shipping !== 'any' && shipLabel(sp),
    sp.intent && `✦ ${sp.intent}`,
  ].filter(Boolean).join('\n')
}
const shipLabel = (sp: any) => SHIPPING.find(x => x.v === (sp?.shipping === 'only' ? 'ship' : sp?.shipping))?.label
</script>

<template>
  <Panel title="Suchen">
    <template #actions>
      <button class="btn" @click="openNew">{{ editing === 'new' ? 'Abbrechen' : '+ Neu' }}</button>
    </template>

    <form v-if="editing !== null" class="new" @submit.prevent="submit">
      <div class="ask">
        <span class="spark">✦</span>
        <input
          v-model="wish" :disabled="composing" class="wish"
          placeholder="Sag einfach was du suchst — „gebrauchte 27 zoll monitore, nur abholen, max 150“"
          @keydown.enter.prevent="compose"
        >
        <button class="btn" type="button" :disabled="composing || !wish.trim()" @click="compose">
          {{ composing ? 'Denkt…' : 'Ausfüllen' }}
        </button>
      </div>
      <div v-if="steps.length" class="trace small">
        <div v-for="(st, n) in steps" :key="n" class="stepline" :class="st.tone">
          <span class="bul">{{ n === steps.length - 1 && composing ? '◌' : '·' }}</span>{{ st.text }}
        </div>
      </div>

      <div v-if="preview.length" class="preview">
        <div class="small muted">So sähe der Feed aus ({{ preview.length }} Treffer im Testlauf):</div>
        <div class="pv">
          <a v-for="p in preview" :key="p.url" :href="p.url" target="_blank" rel="noopener" class="pvi">
            <img v-if="p.image_url" :src="p.image_url" :alt="p.title" loading="lazy">
            <span class="pvt">{{ p.title }}</span>
            <span class="pvp">{{ p.price_eur == null ? 'VB' : p.price_eur.toLocaleString('de-DE') + ' €' }}</span>
          </a>
        </div>
      </div>

      <div v-if="composed" class="small muted why">✦ {{ composed }} — bitte kurz prüfen, dann speichern.</div>

      <div class="row">
        <label>Name<input v-model="form.name" placeholder="rennrad" required></label>
        <label>Suchwörter<input v-model="form.keyword" placeholder="rtx 3060, rtx 3090" title="Kleinanzeigen verlangt jedes Wort im Inserat: lieber mehrere kurze Stichwörter, mit Komma getrennt; jedes wird einzeln abgefragt" required></label>
      </div>
      <div class="row">
        <label>Muss eins davon enthalten<input v-model="form.terms" placeholder="rennrad, gravel (leer = die Suchwörter)"></label>
        <label>Darf nicht enthalten<input v-model="form.exclude" placeholder="kinder, defekt, rahmen"></label>
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
      <div class="row one">
        <label title="die KI prüft jedes Inserat dagegen — leer lassen = nur Stichwörter">Worauf kommt es wirklich an? (KI)
          <textarea v-model="form.intent" rows="2" placeholder="NAS-Festplatte mit mindestens 6 TB. Keine leeren Gehäuse, keine SSD." />
        </label>
      </div>
      <div class="row end">
        <span class="small muted">
          <template v-if="editing === 'new'">Der erste Lauf merkt sich nur den Stand.</template>
          <template v-else>Prüft gespeicherte Inserate neu, ohne Benachrichtigung.</template>
        </span>
        <button class="btn ghost" type="button" @click="editing = null">Abbrechen</button>
        <button class="btn primary" :disabled="!!busy">
          {{ busy ? 'Speichert…' : editing === 'new' ? 'Suche anlegen' : 'Speichern' }}
        </button>
      </div>
    </form>

    <div v-if="err" class="small bad pad">{{ err }}</div>
    <div v-if="note" class="small muted pad">{{ note }}</div>

    <div v-if="!props.searches.length && editing === null" class="small muted pad">Noch keine Suche.</div>
    <div v-for="s in props.searches" :key="s.id" class="row-item" :class="{ editing: editing === s.id, off: !s.enabled }">
      <span class="dot" :class="s.last_error ? 'bad' : s.enabled ? 'ok' : ''" />
      <div class="min" :title="tip(s)">
        <div class="ell">
          <b>{{ s.name }}</b>
          <span class="small muted kw">{{ s.spec?.keyword }}</span>
          <span v-if="s.spec?.intent" class="ai small">✦</span>
        </div>
        <div v-if="s.last_error" class="small bad ell">{{ s.last_error }}</div>
      </div>
      <span class="small faint when">{{ s.last_polled_at ? vor(s.last_polled_at) : 'noch nie' }}</span>
      <div class="acts">
        <a class="btn ghost ic" :href="s.url" target="_blank" rel="noopener" title="Auf Kleinanzeigen öffnen">↗</a>
        <button class="btn ghost ic" title="Bearbeiten" @click="openEdit(s)">✎</button>
        <button
          v-if="s.spec?.intent" class="btn ghost ic" :disabled="!!busy"
          title="Alle gespeicherten Inserate neu von der KI prüfen lassen"
          @click="act('rejudge', { id: s.id, all: true })"
        >{{ busy === 'rejudge' + s.id ? '…' : '✦' }}</button>
        <button class="btn ghost ic" :disabled="!!busy" :title="s.enabled ? 'Pausieren' : 'Weiter'" @click="act(s.enabled ? 'disable' : 'enable', { id: s.id })">{{ s.enabled ? '❙❙' : '▶' }}</button>
        <button class="btn ghost ic danger" :disabled="!!busy" :class="{ sure: armed === String(s.id) }" :title="armed === String(s.id) ? 'Suche und Treffer löschen' : 'Löschen'" @click="remove(s)">{{ armed === String(s.id) ? 'Sicher?' : '✕' }}</button>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.ask { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 10px; border: 1px solid var(--accent); border-radius: 8px; background: var(--panel); }
.ask .spark { color: var(--accent); font-size: 14px; }
.ask .wish { flex: 1; border: 0; background: transparent; padding: 3px 0; font-size: 13px; }
.wish:focus { outline: none; }
.why { padding-top: 2px; }
.trace { display: flex; flex-direction: column; gap: 2px; padding: 6px 2px 2px; }
.stepline { color: var(--muted); line-height: 1.45; }
.stepline.ok { color: var(--ok); }
.stepline.warn { color: var(--warn); }
.bul { display: inline-block; width: 14px; opacity: .6; }
.preview { padding: 4px 2px; }
.pv { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-top: 6px; }
.pvi { display: flex; flex-direction: column; gap: 2px; background: var(--panel); border: 1px solid var(--line); border-radius: 7px; padding: 6px; color: var(--text); }
.pvi:hover { border-color: var(--accent); text-decoration: none; }
.pvi img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 4px; }
.pvt { font-size: 11.5px; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pvp { font-size: 12px; font-weight: 700; }
.new { display: flex; flex-direction: column; gap: 8px; padding: 10px; margin-bottom: 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 9px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.row.narrow { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.row.one { grid-template-columns: 1fr; }
textarea { resize: vertical; }
.row.end { display: flex; align-items: center; gap: 10px; }
.row.end .btn:first-of-type { margin-left: auto; }
label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); min-width: 0; }
.new input, .new select, .new textarea { background: var(--panel); border: 1px solid var(--line-2); border-radius: 6px; padding: 5px 8px; color: var(--text); font: inherit; font-size: 13px; min-width: 0; }
.row-item { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
.row-item.off { opacity: .6; }
.kw { margin-left: 8px; }
.ai { color: var(--accent); margin-left: 6px; }
.acts { display: flex; gap: 0; flex: none; }
.ic { width: 30px; height: 30px; padding: 0; font-size: 13px; }
.row-item + .row-item { border-top: 1px solid var(--line); }
.row-item.editing { background: var(--accent-soft); border-radius: 7px; padding-inline: 8px; }
.min { flex: 1; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pad { padding: 6px 0; }
@media (max-width: 700px) {
  .row, .row.narrow { grid-template-columns: 1fr 1fr; }
  .row.end { flex-wrap: wrap; }
  .when { display: none; }
  .new input, .new select, .new textarea, .ask .wish { font-size: 16px; }
}
</style>
