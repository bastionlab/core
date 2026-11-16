<script setup lang="ts">
/** Remote access: pick how you reach Bastion from outside (Tailscale, Headscale, NetBird, WireGuard or home network only). Settings and the setup wizard. */
type P = { id: string, name: string, installed: boolean, up: boolean, detail: string, set?: boolean, peers?: number }
const emit = defineEmits<{ changed: [] }>()
const d = ref<{ provider: string, providers: P[], lan?: string } | null>(null)
const busy = ref(false)
const err = ref('')
const f = reactive({ server: '', key: '', name: '', endpoint: '' })
const peer = ref<{ name: string, config: string } | null>(null)
const copied = ref(false)
const cur = computed(() => d.value?.providers.find(p => p.id === d.value?.provider))
const fail = (e: any) => { err.value = e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed' }
async function load() { try { d.value = await $fetch('/api/vpn') } catch (e) { fail(e) } }
async function post(step: string, body: any) {
  busy.value = true; err.value = ''
  try { const r: any = await $fetch(`/api/vpn/${step}`, { method: 'POST', body }); if (r.providers) d.value = r; emit('changed'); return r } catch (e) { fail(e) } finally { busy.value = false }
}
const choose = (id: string) => d.value?.provider !== id && post('provider', { provider: id })
const connect = () => post('connect', { provider: d.value!.provider, server: f.server, key: f.key }).then(() => (f.key = ''))
const wgInit = () => post('wg-init', {})
async function addPeer() { const r = await post('wg-peer', { name: f.name, endpoint: f.endpoint }); if (r?.config) { peer.value = r; f.name = '' } }
async function copy() { await navigator.clipboard?.writeText(peer.value!.config); copied.value = true; setTimeout(() => (copied.value = false), 1500) }
onMounted(load)
</script>

<template>
  <div class="vpn">
    <Skeleton v-if="!d" kind="rows" :n="4" />
    <template v-else>
      <div class="opts" role="radiogroup" aria-label="Remote access">
        <button v-for="p in d.providers" :key="p.id" type="button" class="opt" :class="{ on: p.id === d.provider }" role="radio" :aria-checked="p.id === d.provider" :disabled="busy" @click="choose(p.id)">
          <span class="dot" :class="p.up ? 'ok' : p.installed ? 'warn' : 'bad'" />
          <span class="what"><b>{{ p.name }}</b><span class="faint small">{{ p.detail }}</span></span>
        </button>
      </div>

      <div v-if="cur" class="detail">
        <template v-if="cur.id === 'tailscale'">
          <p class="small muted">{{ cur.up ? 'Connected. Open Bastion from any device on your tailnet.' : 'Run tailscale up on this server, then reload.' }}</p>
        </template>
        <template v-else-if="cur.id === 'headscale' || cur.id === 'netbird'">
          <input v-model="f.server" :placeholder="cur.id === 'headscale' ? 'https://headscale.example.com' : 'Management URL (optional)'" autocapitalize="off" spellcheck="false">
          <input v-model="f.key" type="password" autocomplete="off" :placeholder="cur.id === 'headscale' ? 'Pre-auth key' : 'Setup key'">
          <div class="btns">
            <button type="button" class="btn primary sm" :disabled="busy || !f.key || (cur.id === 'headscale' && !f.server)" @click="connect">Connect</button>
            <span v-if="cur.id === 'headscale'" class="faint small">Moves this server's Tailscale client to your server.</span>
            <span v-else-if="!cur.installed" class="faint small">NetBird is not installed on this server yet.</span>
          </div>
        </template>
        <template v-else-if="cur.id === 'wireguard'">
          <div v-if="!cur.set" class="btns">
            <button type="button" class="btn primary sm" :disabled="busy || !cur.installed" @click="wgInit">Set up WireGuard</button>
            <span class="faint small">{{ cur.installed ? 'Creates a wg0 interface on UDP 51820.' : 'Install wireguard-tools on this server first.' }}</span>
          </div>
          <template v-else>
            <p class="small muted">Forward UDP 51820 on your router to this server, then add a device.</p>
            <input v-model="f.name" placeholder="Device name (phone)" autocapitalize="off" spellcheck="false">
            <input v-model="f.endpoint" placeholder="Public host name or IP" autocapitalize="off" spellcheck="false">
            <button type="button" class="btn primary sm" :disabled="busy || !f.endpoint" @click="addPeer">Add device</button>
            <div v-if="peer" class="peer">
              <div class="btns"><b class="small">{{ peer.name }}</b><button type="button" class="btn sm" @click="copy">{{ copied ? 'Copied' : 'Copy config' }}</button></div>
              <pre class="mono small">{{ peer.config }}</pre>
              <span class="faint small">Shown once. Paste it into the WireGuard app.</span>
            </div>
          </template>
        </template>
        <p v-else class="small muted">Bastion is reachable on your home network only{{ d.lan ? ` (https://${d.lan})` : '' }}.</p>
      </div>
      <div v-if="err" class="errbox small">{{ err }}</div>
    </template>
  </div>
</template>

<style scoped>
.vpn, .detail { display: flex; flex-direction: column; gap: 10px; }
.opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; }
.opt { display: flex; align-items: center; gap: 10px; text-align: left; padding: 10px 12px; min-height: 44px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); color: var(--text); cursor: pointer; }
.opt.on { border-color: var(--accent); background: var(--accent-soft); }
.opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.what { display: flex; flex-direction: column; min-width: 0; }
.btns { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.peer { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.peer pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
