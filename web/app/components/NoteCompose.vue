<script setup lang="ts">
/** a text box that also takes pasted, dropped or picked images; ⌘/Ctrl+Enter saves. Used for new notes and for "add to this note". */
const props = defineProps<{
  placeholder: string
  save: (text: string, images: string[], ai: boolean) => Promise<any>
  draftKey?: string // keeps an unsent draft in this browser
  aiToggle?: boolean
  label?: string
}>()

const text = ref('')
const images = ref<string[]>([])
const uploading = ref(0)
const busy = ref(false)
const err = ref('')
const drag = ref(false)
const ai = ref(true)
const box = ref<HTMLTextAreaElement>()
const file = ref<HTMLInputElement>()

onMounted(() => {
  try {
    if (props.draftKey) {
      const d = JSON.parse(localStorage.getItem(props.draftKey) || 'null')
      if (d) { text.value = d.text ?? ''; images.value = d.images ?? [] }
    }
    if (props.aiToggle) ai.value = localStorage.getItem('notes:ai') !== '0'
  } catch {}
  nextTick(grow)
})
watch([text, images], () => {
  if (props.draftKey) try { localStorage.setItem(props.draftKey, JSON.stringify({ text: text.value, images: images.value })) } catch {}
}, { deep: true })
watch(ai, v => { try { localStorage.setItem('notes:ai', v ? '1' : '0') } catch {} })

function grow() {
  const el = box.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.5)}px`
}

async function add(files: Iterable<File>) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    uploading.value++
    try { images.value.push(await uploadNoteImage(f)) } catch (e: any) { err.value = `Image failed: ${e?.statusMessage || e?.message}` } finally { uploading.value-- }
  }
}
function onPaste(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'))
  if (files.length) { e.preventDefault(); add(files) }
}
function onDrop(e: DragEvent) { drag.value = false; add(e.dataTransfer?.files ?? []) }
function onPick() { add(file.value?.files ?? []); file.value!.value = '' }

const ready = computed(() => (text.value.trim() || images.value.length) && !uploading.value && !busy.value)
async function submit() {
  if (!ready.value) return
  busy.value = true; err.value = ''
  try {
    await props.save(text.value.trim(), images.value, ai.value)
    text.value = ''; images.value = []
    if (props.draftKey) try { localStorage.removeItem(props.draftKey) } catch {}
    nextTick(grow)
  } catch (e: any) { err.value = e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed' } finally { busy.value = false }
}
function onKey(e: KeyboardEvent) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }
defineExpose({ focus: () => box.value?.focus() })
</script>

<template>
  <div class="compose" :class="{ drag }" @dragover.prevent="drag = true" @dragleave="drag = false" @drop.prevent="onDrop">
    <textarea
      ref="box" v-model="text" rows="2" :placeholder="placeholder"
      @input="grow" @paste="onPaste" @keydown="onKey"
    />
    <div v-if="images.length || uploading" class="thumbs">
      <div v-for="(img, i) in images" :key="img" class="thumb">
        <img :src="noteImg(img)" alt="">
        <button type="button" title="remove" @click="images.splice(i, 1)">✕</button>
      </div>
      <div v-for="n in uploading" :key="'u' + n" class="thumb loading" />
    </div>
    <div class="bar">
      <button type="button" class="btn ghost" title="add images (or paste / drop them)" @click="file?.click()">🖼️<span class="hide-s">Image</span></button>
      <input ref="file" type="file" accept="image/*" multiple hidden @change="onPick">
      <label v-if="aiToggle" class="toggle small" title="the local model tidies the text up, adds a title and a topic — your original text is always kept">
        <input v-model="ai" type="checkbox"> ✨ tidy up
      </label>
      <span v-if="err" class="bad small err">{{ err }}</span>
      <span class="sp" />
      <span class="faint small hide-s">⌘↵</span>
      <button type="button" class="btn primary" :disabled="!ready" @click="submit">{{ busy ? 'Saving…' : label ?? 'Save' }}</button>
    </div>
  </div>
</template>

<style scoped>
.compose { border: 1px solid var(--line-2); border-radius: 10px; background: var(--panel-2); transition: border-color .15s; }
.compose:focus-within, .compose.drag { border-color: var(--accent); }
.compose.drag { background: var(--accent-soft); }
textarea { display: block; width: 100%; border: 0; background: transparent; resize: none; padding: 12px 14px 4px; font-size: 15px; line-height: 1.5; min-height: 52px; }
textarea:focus-visible { border: 0; }
.thumbs { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 14px; }
.thumb { position: relative; width: 72px; height: 72px; border-radius: 8px; overflow: hidden; background: var(--panel); border: 1px solid var(--line); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb button { position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, .65); color: #fff; font-size: 11px; cursor: pointer; }
.thumb.loading { animation: pulse 1s infinite alternate; }
@keyframes pulse { to { background: var(--line-2); } }
.bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px 8px; }
.toggle { display: flex; align-items: center; gap: 5px; color: var(--muted); cursor: pointer; white-space: nowrap; }
.err { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp { flex: 1; }
@media (max-width: 640px) { .hide-s { display: none; } }
</style>
