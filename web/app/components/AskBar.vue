<script setup lang="ts">
import { parseCommand, type Cmd } from '~/utils/commands'
const props = defineProps<{ busy: boolean, models: any[], placeholder?: string, commands?: Cmd[] }>()
const emit = defineEmits<{ submit: [string], stop: [], focus: [boolean] }>()
const { model, think, web } = useAskSettings()
const q = ref('')
const opts = ref(false)
// grows with what is typed (up to ~8 lines); Enter sends, Shift+Enter starts a new line
const box = ref<HTMLTextAreaElement>()
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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
}
function send() {
  const text = q.value.trim()
  const c = props.commands && parseCommand(text, props.commands)
  if (c?.cmd?.name === 'help') return void (q.value = '/')
  if (c?.cmd?.arg && !c.arg) return void (q.value = `/${c.name} `)
  if (!text || (props.busy && !c?.cmd?.busy)) return
  q.value = ''
  emit('submit', text)
}
</script>

<template>
  <form class="askbar" @submit.prevent="send">
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
    <div class="line">
      <Icon name="spark" :size="17" class="spark" />
      <textarea
        ref="box" v-model="q" class="q" rows="1" :placeholder="placeholder || 'Ask about your server…'" enterkeyhint="send" autocomplete="off"
        @keydown="key" @focus="emit('focus', true)" @blur="emit('focus', false)"
      />
      <button type="button" class="btn ghost ico" :class="{ on: opts }" title="model and tools" @click="opts = !opts">
        <Icon name="settings" :size="16" />
      </button>
      <button v-if="busy" type="button" class="btn ico" title="stop" @click="emit('stop')"><Icon name="stop" :size="15" /></button>
      <button v-else class="btn primary ico" title="ask" :disabled="!q.trim() || !models.length"><Icon name="send" :size="16" /></button>
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
.cmds { position: absolute; left: 0; right: 0; bottom: calc(100% + 10px); z-index: 20; display: flex; flex-direction: column; max-height: min(320px, 45dvh); overflow-y: auto; padding: 4px; background: var(--panel-2); border: 1px solid var(--line-2); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, .45); }
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
.line { display: flex; align-items: flex-end; gap: 6px; }
.line > .spark { align-self: center; }
.spark { color: var(--accent); margin: 0 4px 0 2px; }
.askbar textarea.q { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; line-height: 20px; padding: 7px 0; outline: none; resize: none; max-height: 200px; overflow-y: auto; }
.askbar textarea.q::placeholder { color: var(--faint); }
.ico { padding: 0; width: 34px; height: 34px; border-radius: 9px; }
.ghost.on { color: var(--accent); background: var(--accent-soft); }
.opts { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 0 2px 31px; color: var(--muted); }
.opts select { padding: 5px 8px; font-size: 12px; max-width: 220px; }
.toggle { display: flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
@media (max-width: 640px) {
  .opts { padding-left: 0; }
  .opts select { flex: 1 1 100%; max-width: none; font-size: 16px; }
}
</style>
