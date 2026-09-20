<script setup lang="ts">
const props = defineProps<{ searches: any[] }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const SHIPPING = [
  { v: 'any', label: 'egal' },
  { v: 'pickup', label: 'nur Abholen' },
  { v: 'ship', label: 'nur Versand' },
]

const blank = () => ({ name: '', keyword: '', terms: '', exclude: '', minPrice: '', maxPrice: '', radius: '10', shipping: 'any', intent: '' })
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
    err.value = e?.statusMessage || e?.message || 'failed'
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
    err.value = e?.message || 'the model could not be reached'
  } finally { composing.value = false }
}

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
      <div class="row one">
        <label>Worauf kommt es wirklich an? <span class="hint">die KI prüft jedes Inserat dagegen — leer lassen = nur Stichwörter</span>
          <textarea v-model="form.intent" rows="2" placeholder="NAS-Festplatte mit mindestens 6 TB. Keine leeren Gehäuse, keine SSD." />
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
        <div v-if="s.spec?.intent" class="small accent ell">✦ {{ s.spec.intent }}</div>
        <div v-if="s.last_error" class="small bad">{{ s.last_error }}</div>
      </div>
      <span class="small muted when">{{ s.last_polled_at ? ago(s.last_polled_at) : 'never' }}</span>
      <a class="btn ghost" :href="s.url" target="_blank" rel="noopener" title="Open this search on Kleinanzeigen">↗</a>
      <button class="btn ghost" title="Edit" @click="openEdit(s)">✎</button>
      <button
        v-if="s.spec?.intent" class="btn ghost" :disabled="!!busy"
        title="Alle gespeicherten Inserate neu von der KI prüfen lassen"
        @click="act('rejudge', { id: s.id, all: true })"
      >{{ busy === 'rejudge' + s.id ? '✦…' : '✦' }}</button>
      <button class="btn ghost" :disabled="!!busy" @click="act(s.enabled ? 'disable' : 'enable', { id: s.id })">{{ s.enabled ? 'Pause' : 'Resume' }}</button>
      <button class="btn ghost danger" :disabled="!!busy" @click="remove(s)">✕</button>
    </div>
  </Panel>
</template>

<style scoped>
.ask { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--accent); border-radius: 8px; background: var(--panel); }
.ask .spark { color: var(--accent); font-size: 14px; }
.wish { flex: 1; border: 0; background: transparent; padding: 3px 0; font-size: 13px; }
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
textarea { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; color: var(--text); font: inherit; font-size: 13px; resize: vertical; }
.hint { text-transform: none; opacity: .7; }
.accent { color: var(--accent); }
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
