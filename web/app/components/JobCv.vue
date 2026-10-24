<script setup lang="ts">
const { armed, arm } = useArm()
/** the CV every posting is read against; CT 107 keeps the text and the profile the model made of it */
const emit = defineEmits<{ (e: 'changed'): void }>()
/** with a search tab selected: that search's own CV (or the shared one it falls back to) */
const props = defineProps<{ search?: number | null, searches?: any[] }>()
const sname = computed(() => props.searches?.find((s: any) => s.id === props.search)?.name)
const scoped = computed(() => (props.search ? { searchId: props.search } : {}))

const cv = ref<any>(null)
const loaded = ref(false)
const busy = ref('')
const err = ref('')
const note = ref('')
const editing = ref(false)
const form = reactive({ headline: '', level: 'mid', years: 0, roles: '', skills: '', languages: '', summary: '' })
const file = ref<HTMLInputElement | null>(null)

const LEVELS: Record<string, string> = { junior: 'Junior', mid: 'Mid-Level', senior: 'Senior', lead: 'Lead' }

async function load() {
  try { cv.value = await $fetch('/api/jobs/cv', { query: props.search ? { search: props.search } : {} }) } catch (e: any) { err.value = errText(e) } finally { loaded.value = true }
}
onMounted(load)
watch(() => props.search, () => { editing.value = false; load() })

const p = computed(() => cv.value?.profile ?? {})

function flash(t: string) {
  note.value = t
  setTimeout(() => { note.value = '' }, 6000)
}

function pickFile() { file.value?.click() }

async function upload(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  ;(ev.target as HTMLInputElement).value = ''
  if (!f) return
  if (f.size > 8 * 1024 * 1024) { err.value = 'PDF larger than 8 MB'; return }
  busy.value = 'upload'; err.value = ''
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
      r.onerror = () => reject(r.error)
      r.readAsDataURL(f)
    })
    const r: any = await $fetch('/api/jobs/action', { method: 'POST', body: { action: 'cv', filename: f.name, data, ...scoped.value } })
    await load()
    flash(r.rejudge ? `read · re-scoring ${r.rejudge} postings` : 'read')
    emit('changed')
  } catch (e: any) { err.value = errText(e) } finally { busy.value = '' }
}

function edit() {
  const x = p.value
  Object.assign(form, {
    headline: x.headline ?? '', level: x.level ?? 'mid', years: x.years ?? 0,
    roles: (x.roles ?? []).join(', '), skills: (x.skills ?? []).join(', '),
    languages: (x.languages ?? []).join(', '), summary: x.summary ?? '',
  })
  editing.value = true
}

const split = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
async function save() {
  busy.value = 'save'; err.value = ''
  try {
    const profile = { ...p.value, ...form, roles: split(form.roles), skills: split(form.skills), languages: split(form.languages) }
    const r: any = await $fetch('/api/jobs/action', { method: 'POST', body: { action: 'profile', profile, ...scoped.value } })
    await load()
    editing.value = false
    flash(r.rejudge ? `saved · re-scoring ${r.rejudge} postings` : 'saved')
    emit('changed')
  } catch (e: any) { err.value = errText(e) } finally { busy.value = '' }
}

async function remove() {
  if (!arm('cv')) return
  busy.value = 'del'
  try {
    await $fetch('/api/jobs/action', { method: 'POST', body: { action: 'cvdelete', ...scoped.value } })
    await load()
    emit('changed')
  } catch (e: any) { err.value = errText(e) } finally { busy.value = '' }
}
</script>

<template>
  <Panel
    v-if="loaded" :title="sname ? `CV · ${sname}` : 'CV'"
    :sub="sname ? (cv?.own ? 'own' : 'shared') : ''"
    id="job-cv" :fold="cv?.present ? 'closed' : 'open'"
  >
    <template #actions>
      <span v-if="cv?.present" class="small muted head" :title="cv.filename">{{ p.headline || cv.filename }}</span>
      <button class="btn" :disabled="!!busy" @click.stop="pickFile">
        {{ busy === 'upload' ? 'reading…' : sname && !cv?.own ? '↥ Upload own' : cv?.present ? '↥ Re-upload' : '↥ Upload PDF' }}
      </button>
    </template>
    <input ref="file" type="file" accept="application/pdf,.pdf" hidden @change="upload">

    <div v-if="busy === 'upload'" class="small muted">✦ reading the CV…</div>
    <div v-if="err" class="small bad">{{ err }}</div>
    <div v-if="note" class="small ok">{{ note }}</div>

    <div v-if="!cv?.present && busy !== 'upload'" class="small muted">
      Upload your CV as a PDF – every posting is scored against it.
    </div>

    <template v-else-if="cv?.present && !editing">
      <div class="facts">
        <b>{{ p.name }}</b>
        <span v-if="p.level" class="pill">{{ LEVELS[p.level] ?? p.level }}</span>
        <span v-if="p.years" class="pill">{{ p.years }} yrs experience</span>
        <span v-for="l in p.languages ?? []" :key="l" class="pill ghost">{{ l }}</span>
      </div>
      <div v-if="p.summary" class="small muted sum">{{ p.summary }}</div>
      <div class="chips"><span class="lbl small faint">Roles</span><span v-for="r in p.roles ?? []" :key="r" class="chip on">{{ r }}</span></div>
      <div class="chips"><span class="lbl small faint">Skills</span><span v-for="s in p.skills ?? []" :key="s" class="chip">{{ s }}</span></div>
      <div class="bar">
        <span class="small faint">{{ cv.filename }} · {{ vor(cv.uploaded_at) }} · {{ cv.chars.toLocaleString('de-DE') }} chars</span>
        <!-- a search on the shared CV: editing it here would change every search, so only from the shared view -->
        <button v-if="!sname || cv.own" class="btn ghost" @click="edit">✎ Correct</button>
        <button v-if="!sname || cv.own" class="btn ghost danger" :class="{ sure: armed === 'cv' }" :disabled="!!busy" :title="armed === 'cv' ? (sname ? 'The search then falls back to the shared CV' : 'New postings will then be scored against the search wish only') : 'Delete CV'" @click="remove">{{ armed === 'cv' ? 'Sure?' : '✕' }}</button>
      </div>
    </template>

    <form v-else-if="editing" class="ed" @submit.prevent="save">
      <label>Current role<input v-model="form.headline"></label>
      <div class="row">
        <label>Level
          <select v-model="form.level"><option v-for="(l, k) in LEVELS" :key="k" :value="k">{{ l }}</option></select>
        </label>
        <label>Years of experience<input v-model.number="form.years" type="number" min="0" max="60"></label>
      </div>
      <label>Roles (comma-separated)<textarea v-model="form.roles" rows="2" /></label>
      <label>Skills (comma-separated)<textarea v-model="form.skills" rows="3" /></label>
      <label>Languages (comma-separated)<input v-model="form.languages"></label>
      <label>Summary<textarea v-model="form.summary" rows="3" /></label>
      <div class="bar">
        <button class="btn ghost" type="button" @click="editing = false">Cancel</button>
        <button class="btn primary" :disabled="!!busy">{{ busy === 'save' ? '…' : 'Save' }}</button>
      </div>
    </form>
  </Panel>
</template>

<style scoped>
.head { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pill.ghost { background: transparent; border: 1px solid var(--line); }
.sum { margin: 8px 0; line-height: 1.4; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; }
.lbl { width: 76px; flex: none; }
.chips .chip { cursor: default; min-height: 0; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
.bar > :first-child { margin-right: auto; }
.ed { display: flex; flex-direction: column; gap: 8px; }
.ed .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ed label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); }
.ed input, .ed select, .ed textarea { padding: 5px 8px; }
@media (max-width: 640px) {
  .head { display: none; }
}
</style>
