<script setup lang="ts">
/** one Discord webhook per channel of the homelab server; deals, flats, jobs, money and host alerts post there instead of Telegram */
const { data, refresh } = useFetch<any>('/api/discord')
const what: Record<string, string> = {
  deals: 'Schnäppchen von Kleinanzeigen',
  wohnungen: 'neue gute Wohnungen',
  jobs: 'neue Jobs mit hohem Fit',
  money: 'Abos, auffällige Abbuchungen, Monatsbericht',
  alerts: 'Backups, volle Disks, Bank-/TR-Logins, kaputte Parser',
}
const urls = reactive<Record<string, string>>({})
const msg = reactive<Record<string, string>>({})
const busy = ref('')
async function call(channel: string, body: any) {
  busy.value = channel; msg[channel] = ''
  try { return await $fetch<any>('/api/discord', { method: 'POST', body: { channel, ...body } }) }
  catch (e: any) { msg[channel] = e?.data?.statusMessage || e?.message } finally { busy.value = '' }
}
async function save(ch: string, url: string) {
  const r = await call(ch, { url })
  if (!r) return
  urls[ch] = ''
  const off = Object.entries(r.pushed || {}).filter(([, ok]) => !ok).map(([ct]) => ct)
  msg[ch] = (url ? '✓ gespeichert' : '✓ entfernt') + (off.length ? ` – CT ${off.join(', ')} nicht erreicht` : '')
  refresh()
}
async function test(ch: string) { const r = await call(ch, { action: 'test' }); if (r) msg[ch] = r.sent ? '✓ Testnachricht gesendet' : 'Senden fehlgeschlagen' }
const count = computed(() => (data.value?.channels || []).filter((c: any) => c.set).length)
</script>

<template>
  <Panel title="Discord" :sub="`${count}/5 Kanäle verbunden`" fold="closed">
    <p class="small muted">Pro Kanal: ⚙️ Kanal bearbeiten → Integrationen → Webhooks → Neuer Webhook → URL kopieren und hier einfügen.
      Ein gesetzter Kanal ersetzt Telegram für seine Nachrichten.</p>
    <div v-for="c in data?.channels || []" :key="c.key" class="ch">
      <div class="head">
        <b>#{{ c.key }}</b>
        <span class="small" :class="c.set ? 'ok' : 'muted'">{{ c.set ? `✓ ${c.name || 'verbunden'}` : 'nicht gesetzt' }}</span>
      </div>
      <div class="small muted">{{ what[c.key] }}</div>
      <div class="row">
        <input v-model="urls[c.key]" placeholder="https://discord.com/api/webhooks/…" autocomplete="off" spellcheck="false">
        <button class="btn primary" :disabled="!!busy || !urls[c.key]?.trim()" @click="save(c.key, urls[c.key].trim())">Speichern</button>
        <button v-if="c.set" class="btn" :disabled="!!busy" @click="test(c.key)">Testen</button>
        <button v-if="c.set" class="btn" :disabled="!!busy" @click="save(c.key, '')">Entfernen</button>
      </div>
      <p v-if="msg[c.key]" class="small" :class="msg[c.key].startsWith('✓') ? 'ok' : 'bad'">{{ msg[c.key] }}</p>
    </div>
  </Panel>
</template>

<style scoped>
.ch { margin-top: 14px; }
.head { display: flex; gap: 10px; align-items: baseline; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.row input { flex: 1; min-width: 180px; padding: 6px 10px; font-family: var(--mono); font-size: 12.5px; }
p { margin: 0; }
</style>
