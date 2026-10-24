<script setup lang="ts">
const { hostIp } = useDashConfig()
const props = defineProps<{ ports: any, cts: any[] }>()
const name = (id: string | number) => (id === 'pve' ? 'pve' : props.cts.find(c => String(c.vmid) === String(id))?.name ?? id)
const ip = (id: string | number) => (id === 'pve' ? hostIp.value : props.cts.find(c => String(c.vmid) === String(id))?.ip)

const hidden = new Set(['tailscaled'])
/** one row per machine: what it shares on the tailnet and what it listens on, folded until opened */
const hosts = computed(() =>
  [['pve', props.ports.host], ...Object.entries(props.ports.cts)].map(([id, v]: any) => ({
    id, name: name(id), ip: ip(id),
    serve: v.serve ?? [],
    listen: v.listen.filter((p: any) => !hidden.has(p.proc) && !(p.port === 25 && p.local) && !(id === 'pve' && ['rpcbind', 'pvedaemon', 'spiceproxy'].includes(p.proc))),
  })),
)
const open = useState<Record<string, boolean>>('ports:open', () => ({}))
const publicCount = computed(() => hosts.value.reduce((s, h) => s + h.serve.filter((x: any) => x.public).length, 0))
const sharedCount = computed(() => hosts.value.reduce((s, h) => s + h.serve.length, 0))
</script>

<template>
  <Panel id="ports" title="Ports" fold="closed" :sub="`${sharedCount} on the tailnet`">
    <template #actions>
      <span v-if="publicCount" class="pill bad">{{ publicCount }} public</span>
    </template>
    <div class="hosts">
      <div v-for="h in hosts" :key="h.id" class="host" :class="{ open: open[h.id] }">
        <button class="row" @click="open[h.id] = !open[h.id]">
          <span class="chev">›</span>
          <b>{{ h.name }}</b>
          <span class="faint small mono ip">{{ h.ip }}</span>
          <span class="counts small">
            <span v-if="h.serve.some((s: any) => s.public)" class="pill bad">public</span>
            <span v-if="h.serve.length" class="pill accent">{{ h.serve.length }} shared</span>
            <span class="muted">{{ h.listen.filter((p: any) => !p.local).length }} open</span>
          </span>
        </button>
        <div v-if="open[h.id]" class="detail">
          <div v-for="s in h.serve" :key="s.url" class="serve small">
            <span v-if="s.public" class="pill bad">public</span>
            <a :href="s.url" target="_blank" class="mono">{{ s.url.replace('https://', '').replace(/\.tail[\w]+\.ts\.net/, '') }}</a>
            <span class="faint mono">→ {{ s.target?.replace(/^https?:\/\/(127\.0\.0\.1|localhost)/, '') }}</span>
          </div>
          <div class="plist">
            <component :is="p.local ? 'span' : 'a'" v-for="p in h.listen" :key="p.port + p.proc"
              class="port" :class="{ local: p.local }" :href="p.local ? undefined : `http://${h.ip}:${p.port}`" target="_blank"
              :title="`${p.addr}:${p.port}${p.local ? ' (localhost only)' : ''}`">
              <b class="mono">{{ p.port }}</b> <span class="small">{{ p.proc }}</span>
            </component>
          </div>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.hosts { display: flex; flex-direction: column; }
.host + .host { border-top: 1px solid var(--line); }
.row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 0; background: none; border: 0; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.row:hover b { color: var(--accent); }
.chev { color: var(--faint); width: 10px; transition: transform .15s; }
.open .chev { transform: rotate(90deg); }
.counts { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.detail { padding: 0 0 12px 18px; display: flex; flex-direction: column; gap: 6px; }
.serve { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; min-width: 0; }
.serve a { overflow-wrap: anywhere; }
.plist { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.port { display: inline-flex; gap: 5px; align-items: baseline; padding: 2px 8px; border-radius: 6px; background: var(--panel-2); border: 1px solid var(--line); color: var(--text); }
.port span { color: var(--muted); }
a.port:hover { border-color: var(--accent); text-decoration: none; }
.port.local { opacity: .45; }
@media (max-width: 640px) { .ip { display: none; } }
</style>
