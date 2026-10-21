<script setup lang="ts">
/** where money pushes go (Discord webhook, else own Telegram bot, else the Schnäppchen bot), set it up, test it, send/preview the month report */
const props = defineProps<{ tg: any }>()
const emit = defineEmits<{ changed: [] }>()
const token = ref('')
const msg = ref('')
const busy = ref(false)
const preview = ref('')
const lastMonth = (() => { const d = new Date(); d.setDate(0); return isoMonth(d) })()
async function call(action: string, body: any = {}) {
  busy.value = true; msg.value = ''
  try { return await $fetch<any>('/api/money/action', { method: 'POST', body: { action, ...body } }) }
  catch (e: any) { msg.value = e?.data?.statusMessage || e?.message } finally { busy.value = false; emit('changed') }
}
async function save() {
  const r = await call('telegramConfig', { token: token.value.trim() })
  if (r) { token.value = ''; msg.value = r.chat ? `✓ @${r.bot} verbunden` : `✓ @${r.bot} gespeichert – schick dem Bot jetzt einmal „/start“, dann „Testen“` }
}
async function test() { const r = await call('telegramTest'); if (r) msg.value = r.sent ? '✓ Testnachricht gesendet' : !r.discord && r.own && !r.chat ? 'Schick dem Bot erst „/start“ in Telegram' : 'Senden fehlgeschlagen' }
async function send() { const r = await call('reportSend', { month: lastMonth }); if (r) msg.value = r.sent ? `✓ Bericht ${monthTitle(lastMonth)} gesendet` : 'Senden fehlgeschlagen' }
async function show() {
  if (preview.value) { preview.value = ''; return }
  try { preview.value = (await $fetch<any>('/api/money/report', { query: { month: lastMonth } })).text } catch (e: any) { msg.value = e?.data?.statusMessage || e?.message }
}
const html = computed(() => preview.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/&lt;(\/?)b>/g, '<$1b>').replace(/\n/g, '<br>'))
</script>

<template>
  <Panel title="Benachrichtigungen" :sub="tg?.discord ? 'Discord #money' : tg?.own ? (tg.chat ? `eigener Bot @${tg.bot}` : `@${tg.bot} – wartet auf /start`) : 'über den Schnäppchen-Bot'" id="money-telegram" fold="closed">
    <p class="small muted">Abo-Preise, auffällige Abbuchungen, Bank-Logins und am Monatsanfang der Bericht.
      <b>Discord</b> (#money, Logins/Fehler in #alerts) stellst du unter Metrics → Discord ein; ist es gesetzt, geht alles dorthin statt zu Telegram.</p>
    <p class="small muted" style="margin-top:10px"><b>Telegram:</b> Ein eigener Bot hält das getrennt von den Schnäppchen:
      in Telegram <b>@BotFather</b> → <code>/newbot</code>, Token hier einfügen, dann dem neuen Bot <code>/start</code> schicken.</p>
    <div class="row">
      <input v-model="token" placeholder="Bot-Token 123456:ABC…" autocomplete="off" spellcheck="false">
      <button class="btn primary" :disabled="busy || !token.trim()" @click="save">Speichern</button>
    </div>
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
.row input { flex: 1; min-width: 180px; padding: 6px 10px; font-family: var(--mono); font-size: 12.5px; }
.pv { margin-top: 10px; padding: 10px 12px; background: var(--panel-2); border-radius: 10px; line-height: 1.6; }
p { margin: 0; }
</style>
