<script setup lang="ts">
/** where money pushes go (Discord #money / #alerts), test it, send/preview the month report */
const props = defineProps<{ n: any }>()
const emit = defineEmits<{ changed: [] }>()
const msg = ref('')
const busy = ref(false)
const preview = ref('')
const lastMonth = (() => { const d = new Date(); d.setDate(0); return isoMonth(d) })()
async function call(action: string, body: any = {}) {
  busy.value = true; msg.value = ''
  try { return await $fetch<any>('/api/money/action', { method: 'POST', body: { action, ...body } }) }
  catch (e: any) { msg.value = e?.data?.statusMessage || e?.message } finally { busy.value = false; emit('changed') }
}
async function test() { const r = await call('notifyTest'); if (r) msg.value = r.sent ? '✓ Testnachricht in #money gesendet' : !r.money ? 'Erst unter Metrics → Discord den #money-Webhook setzen' : 'Senden fehlgeschlagen' }
async function send() { const r = await call('reportSend', { month: lastMonth }); if (r) msg.value = r.sent ? `✓ Bericht ${monthTitle(lastMonth)} gesendet` : 'Senden fehlgeschlagen' }
async function show() {
  if (preview.value) { preview.value = ''; return }
  try { preview.value = (await $fetch<any>('/api/money/report', { query: { month: lastMonth } })).text } catch (e: any) { msg.value = e?.data?.statusMessage || e?.message }
}
const html = computed(() => preview.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/&lt;(\/?)b>/g, '<$1b>').replace(/\n/g, '<br>'))
</script>

<template>
  <Panel title="Benachrichtigungen" :sub="n?.money ? `Discord #money${n.alerts ? ' + #alerts' : ''}` : 'Discord nicht eingerichtet'" id="money-notify" fold="closed">
    <p class="small muted">Abo-Preise, auffällige Abbuchungen und am Monatsanfang der Bericht gehen nach <b>#money</b>;
      Bank-/TR-Logins und fehlgeschlagene Syncs nach <b>#alerts</b>. Die Webhooks stellst du unter <NuxtLink to="/metrics">Metrics → Discord</NuxtLink> ein.</p>
    <div class="row">
      <button class="btn" :disabled="busy" @click="test">Testen</button>
      <button class="btn" :disabled="busy" @click="show">{{ preview ? 'Vorschau zu' : `Bericht ${monthTitle(lastMonth).split(' ')[0]} ansehen` }}</button>
      <button class="btn" :disabled="busy" @click="send">jetzt senden</button>
    </div>
    <p v-if="msg" class="small" :class="msg.startsWith('✓') ? 'ok' : 'bad'">{{ msg }}</p>
    <div v-if="preview" class="pv small" v-html="html" />
  </Panel>
</template>

<style scoped>
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.pv { margin-top: 10px; padding: 10px 12px; background: var(--panel-2); border-radius: 10px; line-height: 1.6; }
p { margin: 0; }
</style>
