<script setup lang="ts">
const props = defineProps<{ ports: any, cts: any[] }>()
const name = (id: string | number) => (id === 'pve' ? 'pve' : props.cts.find(c => String(c.vmid) === String(id))?.name ?? id)
const ip = (id: string | number) => (id === 'pve' ? '192.168.1.50' : props.cts.find(c => String(c.vmid) === String(id))?.ip)

const shared = computed(() => [
  ...props.ports.host.serve.map((s: any) => ({ ...s, where: 'pve' })),
  ...Object.entries(props.ports.cts).flatMap(([id, v]: [string, any]) => v.serve.map((s: any) => ({ ...s, where: id }))),
])
const hidden = new Set(['tailscaled'])
const listening = computed(() =>
  [['pve', props.ports.host], ...Object.entries(props.ports.cts)].map(([id, v]: any) => ({
    id, name: name(id), ip: ip(id),
    ports: v.listen.filter((p: any) => !hidden.has(p.proc) && !(p.port === 25 && p.local) && !(id === 'pve' && ['rpcbind', 'pvedaemon', 'spiceproxy'].includes(p.proc))),
  })),
)
</script>

<template>
  <Panel id="ports" title="Ports & exposure" sub="LAN + tailnet only · router forwarding not tracked">
    <h3>Shared on the tailnet <span class="muted small">tailscale serve</span></h3>
    <div class="scroll-x">
      <table v-if="shared.length">
        <tbody>
          <tr v-for="s in shared" :key="s.url">
            <td><span class="pill" :class="s.public ? 'bad' : 'accent'">{{ s.public ? 'public' : 'tailnet' }}</span></td>
            <td><a :href="s.url" target="_blank" class="mono">{{ s.url.replace('https://', '') }}</a></td>
            <td class="muted mono">→ {{ s.target?.replace('http://', '') }}</td>
            <td class="num muted">{{ name(s.where) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="faint small">Nothing shared</div>
    </div>

    <h3>Listening <span class="muted small">faded = localhost only</span></h3>
    <div class="hosts">
      <div v-for="h in listening" :key="h.id" class="host">
        <div class="hn"><b>{{ h.name }}</b> <span class="faint small mono">{{ h.ip }}</span></div>
        <div class="plist">
          <component :is="p.local ? 'span' : 'a'" v-for="p in h.ports" :key="p.port + p.proc"
            class="port" :class="{ local: p.local }" :href="p.local ? undefined : `http://${h.ip}:${p.port}`" target="_blank" :title="`${p.addr}:${p.port}`">
            <b class="mono">{{ p.port }}</b> <span class="small">{{ p.proc }}</span>
          </component>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
h3 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
h3:not(:first-child) { margin-top: 18px; }
td:first-child { width: 1%; }
.hosts { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.host { background: var(--panel-2); border-radius: 8px; padding: 10px 12px; }
.hn { margin-bottom: 6px; }
.plist { display: flex; flex-wrap: wrap; gap: 5px; }
.port { display: inline-flex; gap: 5px; align-items: baseline; padding: 2px 8px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); color: var(--text); }
.port span { color: var(--muted); }
a.port:hover { border-color: var(--accent); text-decoration: none; }
.port.local { opacity: .5; }
</style>
