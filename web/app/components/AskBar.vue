<script setup lang="ts">
import { parseCommand, type Cmd } from '~/utils/commands'
const props = defineProps<{ busy: boolean, models: any[], placeholder?: string, commands?: Cmd[], draftKey?: string, images?: boolean }>()
const emit = defineEmits<{ submit: [string, string[]], stop: [], focus: [boolean] }>()
const { model, think, web } = useAskSettings()
const q = ref('')
const imgs = ref<string[]>([]) // pasted/picked/dropped screenshots and files, already uploaded
const opts = ref(false)

// an unsent draft survives switching tabs and reloads, one per draftKey (the chat page keys it by chat)
let loaded = ''
function loadDraft(k?: string) {
  loaded = k ?? ''
  let d: any = null
  try { d = k ? JSON.parse(localStorage.getItem(k) || 'null') : null } catch {}
  q.value = d?.q ?? ''
  imgs.value = d?.imgs ?? []
}
onMounted(() => loadDraft(props.draftKey))
watch(() => props.draftKey, k => loadDraft(k))
watch([q, imgs], () => {
  if (!loaded) return
  try { q.value || imgs.value.length ? localStorage.setItem(loaded, JSON.stringify({ q: q.value, imgs: imgs.value })) : localStorage.removeItem(loaded) } catch {}
}, { deep: true })

const uploading = ref(0)
const imgErr = ref('')
const file = ref<HTMLInputElement>()
const isImg = (n: string) => /\.(jpg|png|webp)$/.test(n) && !n.includes('-')
const fileLabel = (n: string) => n.replace(/^[a-f0-9]{24}-/, '')
// photos get shrunk in the page first; anything else (pdf, text, zip…) goes up as it is
const shrinkable = (f: File) => /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(f.type)
async function addImages(files: Iterable<File>) {
  imgErr.value = ''
  for (const f of files) {
    uploading.value++
    try { imgs.value.push(shrinkable(f) ? await uploadNoteImage(f, '/api/chat/image') : await uploadChatFile(f)) } catch (e: any) { imgErr.value = `${f.name || 'file'} failed: ${e?.data?.statusMessage || e?.statusMessage || e?.message}` } finally { uploading.value-- }
  }
}
function onPaste(e: ClipboardEvent) {
  if (!props.images) return
  const files = [...(e.clipboardData?.files ?? [])]
  if (files.length) { e.preventDefault(); addImages(files) }
}
function onDrop(e: DragEvent) { if (props.images) addImages(e.dataTransfer?.files ?? []) }
function onPick() { const fs = [...(file.value?.files ?? [])]; file.value!.value = ''; addImages(fs) } // copy before clearing empties the list
// grows with what is typed (up to ~8 lines); Enter sends, Shift+Enter starts a new line
const box = ref<HTMLTextAreaElement>()
// on a touchscreen Enter is a new line (no Shift there); the send button sends
const touch = ref(false)
onMounted(() => { touch.value = matchMedia('(pointer: coarse)').matches })
const fit = () => { const el = box.value; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px' }
watch(q, () => nextTick(fit))

// typing / opens the command list, like Claude Code; after "/model " it offers the choices
interface Item { cmd: Cmd, choice?: string }
const sel = ref(0)
const shut = ref(false) // Esc closes it until the text changes
const items = computed<Item[]>(() => {
  const v = q.value
  if (!props.commands?.length || shut.value || !v.startsWith('/') || v.includes('\n')) return []
  const sp = v.indexOf(' ')
  if (sp < 0) {
    const w = v.slice(1).toLowerCase()
    return props.commands.filter(c => c.name.startsWith(w)).map(cmd => ({ cmd }))
  }
  const cmd = props.commands.find(c => c.name === v.slice(1, sp).toLowerCase())
  const w = v.slice(sp + 1).trim().toLowerCase()
  return (cmd?.choices ?? []).filter(x => x.toLowerCase().includes(w)).slice(0, 8).map(choice => ({ cmd: cmd!, choice }))
})
watch(q, () => { shut.value = false; sel.value = 0 })
const list = ref<HTMLElement>()
watch(sel, i => nextTick(() => list.value?.children[i]?.scrollIntoView({ block: 'nearest' })))
/** Enter or a tap runs it (or asks for its argument first); Tab only fills it in */
function pick(it: Item, run = true) {
  const c = it.cmd
  box.value?.focus()
  if (it.choice != null) q.value = `/${c.name} ${it.choice}`
  else if (c.name === 'help') return void (q.value = '/')
  else if (c.arg) return void (q.value = `/${c.name} `)
  else q.value = `/${c.name}`
  if (run) send()
}

function key(e: KeyboardEvent) {
  if (items.value.length) {
    const n = items.value.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel.value = (sel.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; return }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) { e.preventDefault(); return pick(items.value[sel.value]!, e.key === 'Enter') }
    if (e.key === 'Escape') { e.preventDefault(); shut.value = true; return }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch.value) { e.preventDefault(); send() }
}
function send() {
  const text = q.value.trim()
  const c = props.commands && parseCommand(text, props.commands)
  if (c?.cmd?.name === 'help') return void (q.value = '/')
  if (c?.cmd?.arg && !c.arg) return void (q.value = `/${c.name} `)
  const att = props.images ? imgs.value : []
  if ((!text && !att.length) || uploading.value || (props.busy && !c?.cmd?.busy)) return
  q.value = ''
  imgs.value = props.images ? [] : imgs.value
  emit('submit', text, att)
}
</script>

<template>
  <form class="askbar" @submit.prevent="send" @dragover.prevent @drop.prevent="onDrop">
    <div v-if="items.length" ref="list" class="cmds" role="listbox">
      <button
        v-for="(it, i) in items" :key="it.cmd.name + (it.choice ?? '')" type="button" role="option" class="cmd" :class="{ on: i === sel }"
        :aria-selected="i === sel" @mousedown.prevent @mouseenter="sel = i" @click="pick(it)"
      >
        <template v-if="it.choice != null"><span class="mono faint">/{{ it.cmd.name }}</span> <b>{{ it.choice }}</b></template>
        <template v-else>
          <span class="mono nm">/{{ it.cmd.name }}<span v-if="it.cmd.arg" class="faint"> &lt;{{ it.cmd.arg }}&gt;</span></span>
          <span class="muted small ds">{{ it.cmd.desc }}</span>
          <span v-if="it.cmd.prompt" class="faint small tag">asks Claude</span>
        </template>
      </button>
    </div>
    <div v-if="images && (imgs.length || uploading || imgErr)" class="att">
      <span v-for="(n, i) in imgs" :key="n" class="th">
        <img v-if="isImg(n)" :src="`/api/chat/img/${n}`" alt="screenshot">
        <span v-else class="fchip small" :title="fileLabel(n)"><Icon name="clip" :size="13" /> {{ fileLabel(n) }}</span>
        <button type="button" title="remove" @click="imgs.splice(i, 1)">✕</button>
      </span>
      <span v-if="uploading" class="small faint">uploading…</span>
      <span v-if="imgErr" class="small bad">{{ imgErr }}</span>
    </div>
    <div class="line">
      <Icon name="spark" :size="17" class="spark" />
      <textarea
        ref="box" v-model="q" class="q" rows="1" :placeholder="placeholder || 'Ask about your server…'" :enterkeyhint="touch ? 'enter' : 'send'" autocomplete="off"
        @keydown="key" @paste="onPaste" @focus="emit('focus', true)" @blur="emit('focus', false)"
      />
      <template v-if="images">
        <!-- a label opens the picker natively; .click() on a display:none input is ignored by some browsers (iOS Safari) -->
        <label class="btn ghost ico pick" title="attach screenshots or files (or paste / drop them)">
          <input ref="file" type="file" multiple class="vh" @change="onPick">
          <Icon name="clip" :size="16" />
        </label>
      </template>
      <button type="button" class="btn ghost ico" :class="{ on: opts }" title="model and tools" @click="opts = !opts">
        <Icon name="settings" :size="16" />
      </button>
      <button v-if="busy" type="button" class="btn ico" title="stop" @click="emit('stop')"><Icon name="stop" :size="15" /></button>
      <button v-else class="btn primary ico" title="ask" :disabled="(!q.trim() && !(images && imgs.length)) || !!uploading || !models.length"><Icon name="send" :size="16" /></button>
    </div>
    <div v-if="opts" class="opts small">
      <slot name="opts">
      <select v-model="model" title="model">
        <option v-for="m in models" :key="m.name" :value="m.name">{{ m.name }}{{ m.loaded ? ' •' : '' }}</option>
      </select>
      <label class="toggle" title="let the model search the web, read pages and look up the weather"><input v-model="web" type="checkbox"> web</label>
      <label class="toggle" title="let the model reason before answering (slower, better)"><input v-model="think" type="checkbox"> think</label>
      <span v-if="!models.length" class="bad">Ollama unreachable</span>
      </slot>
    </div>
  </form>
</template>

<style scoped>
.askbar { position: relative; }
.cmds { position: absolute; left: 0; right: 0; bottom: calc(100% + 10px); z-index: 20; display: flex; flex-direction: column; max-height: min(320px, 45dvh); overflow-y: auto; padding: 4px; background: var(--panel-2); border: 1px solid var(--line-2); border-radius: var(--radius-sm); box-shadow: 0 8px 28px rgba(0, 0, 0, .45); }
.cmd { display: flex; align-items: baseline; gap: 10px; text-align: left; font: inherit; color: var(--text); background: transparent; border: 0; border-radius: 7px; padding: 7px 10px; cursor: pointer; min-width: 0; }
.cmd.on { background: var(--accent-soft); }
.cmd .nm { flex-shrink: 0; font-size: 13px; }
.cmd .ds { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd .tag { flex-shrink: 0; }
.cmd b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 640px) {
  .cmd { flex-wrap: wrap; gap: 2px 8px; padding: 9px 10px; }
  .cmd .ds { flex-basis: 100%; white-space: normal; }
  .cmd .tag { display: none; }
}
.att { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 0 6px 31px; }
.th { position: relative; }
.th img { display: block; height: 52px; max-width: 110px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); }
.fchip { display: flex; align-items: center; gap: 5px; height: 30px; max-width: 180px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.th button { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--line-2); background: var(--panel-2); color: var(--muted); font-size: 10px; line-height: 1; padding: 0; cursor: pointer; }
@media (pointer: coarse) { .th button { width: 26px; height: 26px; top: -10px; right: -10px; font-size: 12px; } .th button::after { content: ''; position: absolute; inset: -4px; } }
@media (max-width: 640px) { .att { padding-left: 0; } .askbar textarea.q { font-size: 16px; } } /* under 16px iOS zooms in on focus */
.line { display: flex; align-items: flex-end; gap: 6px; }
.line > .spark { align-self: center; }
.spark { color: var(--accent); margin: 0 4px 0 2px; }
.askbar textarea.q { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; line-height: 20px; padding: 7px 0; outline: none; resize: none; max-height: 200px; overflow-y: auto; }
.askbar textarea.q::placeholder { color: var(--faint); }
.ico { padding: 0; width: 34px; height: 34px; border-radius: var(--radius-sm); }
.pick { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; position: relative; }
.vh { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; pointer-events: none; }
.ghost.on { color: var(--accent); background: var(--accent-soft); }
.opts { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 0 2px 31px; color: var(--muted); }
.opts select { padding: 5px 8px; font-size: 12px; max-width: 220px; }
.toggle { display: flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
@media (max-width: 640px) {
  .opts { padding-left: 0; }
  .opts select { flex: 1 1 100%; max-width: none; font-size: 16px; }
}
</style>
