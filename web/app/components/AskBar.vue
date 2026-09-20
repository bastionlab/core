<script setup lang="ts">
defineProps<{ busy: boolean, models: any[], placeholder?: string }>()
const emit = defineEmits<{ submit: [string], stop: [] }>()
const { model, think, web } = useAskSettings()
const q = ref('')
function send() {
  const text = q.value.trim()
  if (!text) return
  q.value = ''
  emit('submit', text)
}
</script>

<template>
  <form class="bar" @submit.prevent="send">
    <span class="spark">✦</span>
    <input v-model="q" :placeholder="placeholder || 'Ask about your server…'" enterkeyhint="send" autocomplete="off">
    <select v-model="model" class="small" title="model">
      <option v-for="m in models" :key="m.name" :value="m.name">{{ m.name }}{{ m.loaded ? ' •' : '' }}</option>
    </select>
    <label class="small muted toggle" title="let the model search the web, read pages and look up the weather"><input v-model="web" type="checkbox"> web</label>
    <label class="small muted toggle" title="let the model reason before answering (slower, better)"><input v-model="think" type="checkbox"> think</label>
    <button v-if="busy" type="button" class="btn" @click="emit('stop')">Stop</button>
    <button v-else class="btn primary" :disabled="!q.trim() || !models.length">Ask</button>
  </form>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; }
.spark { color: var(--accent); font-size: 16px; padding: 0 2px 0 4px; }
.bar > input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; padding: 6px 0; outline: none; }
select { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 7px; padding: 4px 6px; font: inherit; font-size: 12px; max-width: 190px; }
.toggle { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
@media (max-width: 640px) {
  .bar { flex-wrap: wrap; }
  .bar > input { flex-basis: calc(100% - 30px); }
  select { flex: 1; max-width: none; }
}
</style>
