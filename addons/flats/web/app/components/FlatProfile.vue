<script setup lang="ts">
/** who is applying; CT 107 writes every 💬 draft from this text and nothing else.
 *  With a search tab selected it edits that search's own text (empty = the shared one). */
const props = defineProps<{ search?: number | null, searches?: any[] }>()

const text = ref('')
const saved = ref('')
const own = ref(false)          // the selected search has its own text
const busy = ref(false)
const err = ref('')
const note = ref('')
const loaded = ref(false)

const name = computed(() => props.searches?.find((s: any) => s.id === props.search)?.name)

async function load() {
  try {
    const r = await $fetch<any>('/api/flats/profile', { query: props.search ? { search: props.search } : {} })
    own.value = !!r.own
    saved.value = text.value = r.text ?? ''
  } catch (e: any) { err.value = errText(e) } finally { loaded.value = true }
}
onMounted(load)
watch(() => props.search, load)

async function save(value = text.value) {
  busy.value = true; err.value = ''
  try {
    await $fetch('/api/flats/action', { method: 'POST', body: { action: 'profile', text: value, searchId: props.search ?? null } })
    note.value = props.search && !value.trim() ? 'back to the shared text' : 'saved · new messages use it'
    setTimeout(() => { note.value = '' }, 3000)
    await load()
  } catch (e: any) { err.value = errText(e) } finally { busy.value = false }
}
</script>

<template>
  <Panel
    v-if="loaded" :title="name ? `About us · ${name}` : 'About us'"
    :sub="name ? (own ? 'own text' : 'shared text') : 'for messages to landlords'"
    id="flat-profile" :fold="saved.trim() ? 'closed' : 'open'"
  >
    <textarea
      v-model="text" rows="7" class="ta"
      placeholder="Who you are, job, people, move-in date, documents, contact…"
      title="The AI uses only what is written here and writes in the language of the ad"
    />
    <div class="bar">
      <span v-if="err" class="small bad">{{ err }}</span>
      <span v-else-if="note" class="small ok">{{ note }}</span>
      <button v-if="name && own" class="btn ghost" :disabled="busy" @click="save('')">Use shared</button>
      <button class="btn primary" :disabled="busy || text === saved" @click="save()">{{ busy ? '…' : 'Save' }}</button>
    </div>
  </Panel>
</template>

<style scoped>
.ta { width: 100%; padding: 10px 12px; line-height: 1.45; resize: vertical; box-sizing: border-box; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; }
.bar .btn:first-of-type { margin-left: auto; }
</style>
