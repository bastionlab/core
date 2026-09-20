<script setup lang="ts">
import type { Turn } from '~/composables/useAsk'
const props = defineProps<{ scope: string, examples?: string[], placeholder?: string }>()
const emit = defineEmits<{ refresh: [] }>()

// each page keeps its own conversation while you move around the dashboard
const turns = useState<Turn[]>(`ask:turns:${props.scope}`, () => [])
const { ask, run, stop, busy, models } = useAsk(props.scope, turns)
const clear = () => { stop(); turns.value = [] }
</script>

<template>
  <section id="ask" class="ask">
    <AskBar :busy="busy" :models="models" :placeholder="placeholder" @submit="ask" @stop="stop" />

    <div v-if="!turns.length" class="examples">
      <button v-for="ex in examples ?? []" :key="ex" class="pill" type="button" @click="ask(ex)">{{ ex }}</button>
      <span v-if="!models.length" class="small bad">Ollama unreachable</span>
    </div>

    <div v-else class="body">
      <AskTurns :turns="turns" @run="p => run(p, () => emit('refresh'))" />
      <div class="foot">
        <NuxtLink to="/chat" class="small muted">continue in chat →</NuxtLink>
        <button class="btn ghost small" type="button" @click="clear">clear</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ask { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 16px; scroll-margin-top: 16px; }
.examples { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 0 2px 28px; }
.examples .pill { cursor: pointer; font: inherit; font-size: 12px; }
.examples .pill:hover { color: var(--text); border-color: var(--faint); }
.body { border-top: 1px solid var(--line); margin-top: 10px; padding-top: 4px; max-height: 60vh; overflow-y: auto; }
.foot { display: flex; align-items: center; justify-content: space-between; padding-top: 4px; }
@media (max-width: 640px) { .examples { padding-left: 0; } }
</style>
