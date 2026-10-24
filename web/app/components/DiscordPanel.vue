<script setup lang="ts">
/** one Discord webhook per channel of the homelab server; deals, flats, jobs, money and host alerts post there */
const { data, refresh } = useFetch<any>('/api/discord')
const what: Record<string, string> = {
  deals: 'Deals',
  wohnungen: 'Flats',
  jobs: 'High-fit jobs',
  money: 'Subscriptions, debits, monthly report',
  alerts: 'Backups, disks, logins, parsers',
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
  msg[ch] = (url ? '✓ saved' : '✓ removed') + (off.length ? ` – CT ${off.join(', ')} not reached` : '')
  refresh()
}
async function test(ch: string) { const r = await call(ch, { action: 'test' }); if (r) msg[ch] = r.sent ? '✓ Test message sent' : 'Send failed' }
const count = computed(() => (data.value?.channels || []).filter((c: any) => c.set).length)
</script>

<template>
  <Panel title="Discord" :sub="`${count}/5 channels connected`" fold="closed">
    <p class="small muted">Edit channel → Integrations → Webhooks → paste the URL.</p>
    <div v-for="c in data?.channels || []" :key="c.key" class="ch">
      <div class="head">
        <b>#{{ c.key }}</b>
        <span class="small faint">{{ what[c.key] }}</span>
        <span class="small" :class="c.set ? 'ok' : 'muted'">{{ c.set ? `✓ ${c.name || 'connected'}` : 'not set' }}</span>
      </div>
      <div class="row">
        <input v-model="urls[c.key]" placeholder="Webhook URL" autocomplete="off" spellcheck="false">
        <button class="btn primary" :disabled="!!busy || !urls[c.key]?.trim()" @click="save(c.key, urls[c.key].trim())">Save</button>
        <button v-if="c.set" class="btn" :disabled="!!busy" @click="test(c.key)">Test</button>
        <button v-if="c.set" class="btn" :disabled="!!busy" @click="save(c.key, '')">Remove</button>
      </div>
      <p v-if="msg[c.key]" class="small" :class="msg[c.key].startsWith('✓') ? 'ok' : 'bad'">{{ msg[c.key] }}</p>
    </div>
  </Panel>
</template>

<style scoped>
.ch { margin-top: 14px; }
.head { display: flex; gap: 4px 10px; align-items: baseline; flex-wrap: wrap; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.row input { flex: 1; min-width: 180px; padding: 6px 10px; font-family: var(--mono); }
p { margin: 0; }
</style>
