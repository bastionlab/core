<script setup lang="ts">
const props = defineProps<{ busy: boolean, models: any[], placeholder?: string }>()
const emit = defineEmits<{ submit: [string], stop: [], focus: [boolean] }>()
const { model, think, web } = useAskSettings()
const q = ref('')
const opts = ref(false)
// grows with what is typed (up to ~8 lines); Enter sends, Shift+Enter starts a new line
const box = ref<HTMLTextAreaElement>()
const fit = () => { const el = box.value; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px' }
watch(q, () => nextTick(fit))
function key(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
}
function send() {
  const text = q.value.trim()
  if (!text || props.busy) return
  q.value = ''
  emit('submit', text)
}
</script>

<template>
  <form class="askbar" @submit.prevent="send">
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
