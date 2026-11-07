<script setup lang="ts">
import type { Turn } from '~/composables/useAsk'
const props = defineProps<{ scope: string, examples?: string[], placeholder?: string }>()
const emit = defineEmits<{ refresh: [] }>()

// each page keeps its own conversation while you move around the dashboard
// the Ask bar needs admin (shared/utils/roles.ts)
const { role } = useAddons()
const turns = useState<Turn[]>(`ask:turns:${props.scope}`, () => [])
const { ask, run, stop, busy, models } = useAsk(props.scope, turns)
const clear = () => { stop(); turns.value = [] }
// suggestions only while the empty box is focused — they are a hint, not page content
const focused = ref(false)
</script>

<template>
  <section v-if="!role || atLeast(role, 'admin')" id="ask" class="ask" :class="{ active: focused || turns.length }">
    <AskBar :busy="busy" :models="models" :placeholder="placeholder" @submit="ask" @stop="stop" @focus="f => (focused = f)" />

    <div v-if="!turns.length && focused && examples?.length" class="examples">
      <button v-for="ex in examples" :key="ex" class="pill" type="button" @mousedown.prevent @click="ask(ex)">{{ ex }}</button>
    </div>

    <div v-if="turns.length" class="body">
      <AskTurns :turns="turns" @run="p => run(p, () => emit('refresh'))" />
      <div class="foot">
        <NuxtLink to="/chat" class="small muted">continue in chat</NuxtLink>
        <button class="btn ghost sm" type="button" @click="clear">clear</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ask { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 5px 6px 5px 10px; margin-bottom: 16px; scroll-margin-top: 16px; transition: border-color .15s; }
.ask.active { border-color: var(--line-2); }
.examples { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 0 6px 31px; }
.examples .pill { cursor: pointer; font: inherit; font-size: 12px; padding: 3px 10px; }
.examples .pill:hover { color: var(--text); border-color: var(--faint); }
.body { border-top: 1px solid var(--line); margin: 6px 4px 0 0; padding-top: 4px; max-height: 60vh; overflow-y: auto; }
.foot { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
@media (max-width: 640px) { .examples { padding-left: 0; } }
</style>
