<script setup lang="ts">
/** one note, full size: edit it, add more to it, let the AI rewrite or plan it, undo the AI */
const props = defineProps<{ note: any, notes: any[] }>()
const emit = defineEmits<{
  close: [], open: [number], tag: [string]
  patch: [Record<string, any>]
  act: [string, Record<string, any>?]
}>()
const n = computed(() => props.note)

const title = ref('')
const titleBox = ref<HTMLTextAreaElement>()
// a textarea so a long title wraps instead of scrolling sideways (narrow on a phone); Enter still just saves
function growTitle() { const el = titleBox.value; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }
watch(() => [n.value.id, n.value.title], () => { title.value = n.value.title; nextTick(growTitle) }, { immediate: true })
onMounted(growTitle)
function saveTitle() { if (title.value.trim() !== n.value.title) emit('patch', { title: title.value.trim() }) }

const editing = ref(false)
const draft = ref('')
const original = ref(false)
watch(() => n.value.id, () => { editing.value = false; original.value = false; armed.value = false })
function edit() { draft.value = n.value.body; editing.value = true; original.value = false }
function saveBody() { if (draft.value !== n.value.body) emit('patch', { body: draft.value }); editing.value = false }

// one topic per note (tags were clutter); the datalist offers the topics already in use
const topic = ref('')
watch(() => [n.value.id, n.value.topic], () => { topic.value = n.value.topic }, { immediate: true })
const topics = computed(() => [...new Set(props.notes.map(x => x.topic).filter(Boolean))].sort())
function saveTopic() {
  const t = topic.value.trim().toLowerCase().replace(/\s+/g, '-')
  topic.value = t
  if (t !== n.value.topic) emit('patch', { topic: t })
}

const html = computed(() => noteHtml(n.value.body))
function onBody(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (t instanceof HTMLInputElement && t.dataset.task != null) emit('patch', { body: toggleTask(n.value.body, Number(t.dataset.task)) })
}

// other notes on the same topic, latest first
const related = computed(() => !n.value.topic ? [] : props.notes
  .filter(x => x.id !== n.value.id && x.state !== 'archived' && x.topic === n.value.topic)
  .sort((a, b) => b.updated - a.updated).slice(0, 5))

const armed = ref(false)
let armT: any
function del() {
  if (armed.value) { emit('act', 'delete'); return }
  armed.value = true
  clearTimeout(armT); armT = setTimeout(() => (armed.value = false), 4000)
}
const copied = ref(false)
function copy() {
  navigator.clipboard?.writeText(`# ${n.value.title}\n\n${n.value.body}`)
  copied.value = true; setTimeout(() => (copied.value = false), 1500)
}

const append = (text: string, images: string[]) => new Promise((ok, no) => emit('act', 'append', { text, images, ok, no }))

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing.value) emit('close') }
onMounted(() => { window.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden' })
onUnmounted(() => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' })
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet" role="dialog" :aria-label="n.title">
      <header>
        <select class="kind" :value="n.kind" title="kind" @change="emit('patch', { kind: ($event.target as HTMLSelectElement).value })">
          <option v-for="k in NOTE_KINDS" :key="k.id" :value="k.id">{{ k.icon }} {{ k.label.replace(/s$/, '') }}</option>
        </select>
        <textarea ref="titleBox" v-model="title" class="title" rows="1" placeholder="Title" @input="growTitle" @blur="saveTitle" @keydown.enter.prevent="($event.target as HTMLTextAreaElement).blur()" />
        <button type="button" class="btn ghost x" title="close (Esc)" @click="emit('close')">✕</button>
      </header>

      <div class="meta small">
        <input v-model="topic" class="topic" placeholder="+ topic" list="note-topics" title="topic" @change="saveTopic" @keydown.enter="($event.target as HTMLInputElement).blur()">
        <datalist id="note-topics"><option v-for="t in topics" :key="t" :value="t" /></datalist>
        <span class="faint when">{{ new Date(n.created * 1000).toLocaleDateString('de-DE') }} · edited {{ ago(n.updated) }}</span>
      </div>

      <div v-if="n.job" class="banner accent small">✨ The AI is {{ n.job === 'expand' ? 'working out next steps' : n.job === 'merge' ? 'merging your new thoughts in' : 'tidying this note' }}…</div>
      <div v-else-if="n.aiError" class="banner bad small">
        AI failed: {{ n.aiError }} <button type="button" class="btn ghost" @click="emit('act', 'rewrite')">Retry</button>
      </div>

      <div class="content">
        <template v-if="editing">
          <textarea v-model="draft" class="edit" rows="14" @keydown.meta.enter="saveBody" @keydown.ctrl.enter="saveBody" @keydown.esc.stop="editing = false" />
          <div class="row">
            <span class="faint small">Markdown · "- [ ] " makes a checkbox</span>
            <span class="sp" />
            <button type="button" class="btn ghost" @click="editing = false">Cancel</button>
            <button type="button" class="btn primary" @click="saveBody">Save</button>
          </div>
        </template>
        <pre v-else-if="original" class="raw">{{ n.raw || '(no text)' }}</pre>
        <div v-else class="md body" @click="onBody" @dblclick="edit" v-html="html" />
      </div>

      <div v-if="n.images.length" class="imgs">
        <div v-for="img in n.images" :key="img" class="img">
          <a :href="noteImg(img)" target="_blank" rel="noopener"><img :src="noteImg(img)" alt="" loading="lazy"></a>
          <button v-if="editing" type="button" title="remove image" @click="emit('patch', { images: n.images.filter((x: string) => x !== img) })">✕</button>
        </div>
      </div>

      <div class="tools">
        <button type="button" class="btn" :disabled="editing" @click="edit">✏️ Edit</button>
        <button type="button" class="btn" :class="{ on: original }" :disabled="editing" title="what you originally typed" @click="original = !original">📄 Original</button>
        <button type="button" class="btn" :disabled="!!n.job" title="let the AI tidy the current text again" @click="emit('act', 'rewrite')">✨ Rewrite</button>
        <button type="button" class="btn" :disabled="!!n.job" title="the AI adds next steps and open questions" @click="emit('act', 'expand')">🧭 Next steps</button>
        <button v-if="n.undo && !n.job" type="button" class="btn" title="go back to the text before the last AI change" @click="emit('act', 'undo')">↶ Undo AI</button>
      </div>

      <div class="add">
        <NoteCompose :key="n.id" placeholder="Add more thoughts — the AI merges them in…" label="Add" :save="append" />
      </div>

      <div v-if="related.length" class="related small">
        <span class="faint">Related</span>
        <button v-for="r in related" :key="r.id" type="button" class="rel" @click="emit('open', r.id)">{{ kindIcon(r.kind) }} {{ r.title || 'Untitled' }}</button>
      </div>

      <footer>
        <button type="button" class="btn ghost" :class="{ on: n.pinned }" @click="emit('patch', { pinned: !n.pinned })"><Icon name="pin" :size="14" />{{ n.pinned ? 'Pinned' : 'Pin' }}</button>
        <button type="button" class="btn ghost" @click="emit('patch', { state: n.state === 'done' ? 'active' : 'done' })">✓ {{ n.state === 'done' ? 'Reopen' : 'Done' }}</button>
        <button type="button" class="btn ghost" @click="emit('patch', { state: n.state === 'archived' ? 'active' : 'archived' })">🗄️ {{ n.state === 'archived' ? 'Unarchive' : 'Archive' }}</button>
        <button type="button" class="btn ghost" @click="copy">{{ copied ? 'Copied' : '📋 Copy' }}</button>
        <span class="sp" />
        <button type="button" class="btn danger" :class="{ armed }" @click="del">{{ armed ? 'Sure?' : 'Delete' }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, .55); display: flex; justify-content: center; align-items: flex-start; padding: 5vh 16px; overflow-y: auto; }
.sheet { width: 100%; max-width: 760px; background: var(--panel); border: 1px solid var(--line-2); border-radius: 14px; padding: 16px 20px 14px; display: flex; flex-direction: column; gap: 12px; }
header { display: flex; align-items: flex-start; gap: 8px; }
.kind { padding: 5px 6px; font-size: 12.5px; }
.title { flex: 1; min-width: 0; border: 0 !important; background: transparent !important; font-size: 19px !important; font-weight: 650; line-height: 1.3; padding: 4px 2px; resize: none; overflow: hidden; }
.x { font-size: 15px; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.topic { width: 130px; padding: 2px 10px; font-size: 12px !important; border-radius: 999px !important; color: var(--accent) !important; background: var(--accent-soft) !important; border-color: transparent !important; }
.topic::placeholder { color: var(--faint); }
.when { margin-left: auto; }
.banner { padding: 8px 12px; border-radius: 8px; display: flex; align-items: center; gap: 8px; }
.banner.accent { background: var(--accent-soft); color: var(--accent); }
.banner.bad { background: var(--bad-soft); color: var(--bad); }
.content { min-height: 60px; }
.body { font-size: 14.5px; line-height: 1.6; }
.raw { white-space: pre-wrap; margin: 0; font: inherit; font-size: 14px; color: var(--muted); background: var(--bg); border: 1px dashed var(--line-2); border-radius: 8px; padding: 10px 12px; }
.edit { width: 100%; padding: 10px 12px; font-family: var(--mono); font-size: 13px; line-height: 1.55; resize: vertical; }
.row, footer, .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.row { margin-top: 6px; }
.sp { flex: 1; }
.imgs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.img { position: relative; }
.img img { display: block; width: 100%; height: 150px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
.img button { position: absolute; top: 5px; right: 5px; width: 24px; height: 24px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, .7); color: #fff; cursor: pointer; }
.tools .btn { font-size: 12.5px; padding: 5px 10px; }
.btn.on { color: var(--accent); border-color: var(--accent); }
.related { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rel { border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); border-radius: 999px; padding: 2px 10px; font: inherit; cursor: pointer; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rel:hover { color: var(--text); }
footer { border-top: 1px solid var(--line); padding-top: 10px; }
footer .btn.ghost.on { color: var(--accent); background: transparent; }
.danger.armed { background: var(--bad); color: #0a0c10; border-color: var(--bad); font-weight: 600; }
@media (max-width: 640px) {
  .scrim { padding: 0; }
  .sheet { min-height: 100dvh; border-radius: 0; border: 0; padding: 12px 14px calc(16px + env(safe-area-inset-bottom)); }
  .sheet { gap: 14px; }
  /* kind + ✕ on top, the title gets the full width below */
  header { flex-wrap: wrap; align-items: center; }
  .x { margin-left: auto; }
  .title { order: 3; flex-basis: 100%; font-size: 21px !important; padding: 0 2px; }
  .when { margin-left: 0; flex-basis: 100%; }
  .tools { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tools .btn { justify-content: center; padding: 8px 10px; font-size: 13.5px; }
  .rel { max-width: 100%; }
  /* one even row of actions, pinned to the bottom of the sheet */
  footer { margin-top: auto; flex-wrap: nowrap; gap: 4px; }
  footer .sp { display: none; }
  footer .btn { flex: 1; min-width: 0; justify-content: center; padding: 8px 4px; font-size: 12.5px; white-space: nowrap; }
}
</style>
