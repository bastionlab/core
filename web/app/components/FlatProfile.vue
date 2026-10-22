<script setup lang="ts">
/** who is applying; CT 107 writes every 💬 draft from this text and nothing else */
const text = ref('')
const saved = ref('')
const busy = ref(false)
const err = ref('')
const note = ref('')
const loaded = ref(false)

onMounted(async () => {
  try { saved.value = text.value = (await $fetch<any>('/api/flats/profile')).text ?? '' } catch (e: any) { err.value = errText(e) } finally { loaded.value = true }
})

async function save() {
  busy.value = true; err.value = ''
  try {
    await $fetch('/api/flats/action', { method: 'POST', body: { action: 'profile', text: text.value } })
    saved.value = text.value
    note.value = 'gespeichert · neue Nachrichten nutzen es'
    setTimeout(() => { note.value = '' }, 3000)
  } catch (e: any) { err.value = errText(e) } finally { busy.value = false }
}
</script>

<template>
  <Panel v-if="loaded" title="Über uns" sub="für Nachrichten an Vermieter" id="flat-profile" :fold="saved.trim() ? 'closed' : 'open'">
    <textarea
      v-model="text" rows="7" class="ta"
      placeholder="Namen, wer ihr seid, was ihr macht (Job/Studium, unbefristet?), wie viele Personen, Haustiere, Raucher, Einzug ab, Unterlagen (SCHUFA, Einkommen, Mietschuldenfreiheit), Telefon, E-Mail …"
    />
    <div class="bar">
      <span class="small muted">Die KI nutzt nur, was hier steht, und erfindet nichts dazu.</span>
      <span v-if="err" class="small bad">{{ err }}</span>
      <span v-else-if="note" class="small ok">{{ note }}</span>
      <button class="btn primary" :disabled="busy || text === saved" @click="save">{{ busy ? '…' : 'Speichern' }}</button>
    </div>
  </Panel>
</template>

<style scoped>
.ta { width: 100%; padding: 10px 12px; line-height: 1.45; resize: vertical; box-sizing: border-box; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; }
.bar .btn { margin-left: auto; }
</style>
