<script setup lang="ts">
const props = defineProps<{ vpn: any, torrents?: any }>()
const v = computed(() => props.vpn ?? {})
const t = computed(() => props.torrents ?? {})
/** one verdict from the four things that have to be true at once */
const checks = computed(() => [
  { ok: !!v.value.up, label: 'Tunnel', detail: v.value.health ?? (v.value.up ? 'running' : 'gluetun is not running') },
  { ok: !!v.value.killSwitch, label: 'Kill switch', detail: v.value.killSwitch ? 'OUTPUT policy DROP — nothing leaves except through the tunnel' : 'OUTPUT policy is not DROP' },
  { ok: !!v.value.ip && !v.value.leaking, label: 'IP hidden', detail: v.value.ip ? (v.value.leaking ? `qBittorrent shows your home IP ${v.value.homeIp}` : `qBittorrent shows ${v.value.ip}, not home ${v.value.homeIp ?? '?'}`) : 'no exit IP reported' },
  { ok: !!v.value.portOk, label: 'Port', detail: v.value.forwardedPort ? `${v.value.forwardedPort} → qBittorrent ${v.value.listenPort ?? '?'}${v.value.portOk ? '' : ' (out of sync — no incoming peers)'}` : 'no forwarded port' },
])
const bad = computed(() => checks.value.filter(c => !c.ok))
const verdict = computed(() => {
  if (v.value.leaking || !v.value.killSwitch) return { tone: 'bad', text: 'Not safe' }
  if (!v.value.up) return { tone: 'bad', text: 'Tunnel down' }
  if (bad.value.length) return { tone: 'warn', text: 'Protected, with a niggle' }
  return { tone: 'ok', text: 'Protected' }
})
const where = computed(() => [v.value.city, v.value.country].filter(Boolean).join(', '))
</script>

<template>
  <Panel id="vpn" title="VPN">
    <div class="hero" :class="verdict.tone" :title="v.org ? v.org.replace(/^AS\d+ /, '') : ''">
      <span class="dot" :class="verdict.tone" />
      <div class="who">
        <b>{{ verdict.text }}</b>
        <span class="small muted">{{ where || 'exit' }} · <span class="mono">{{ v.ip ?? '–' }}</span></span>
      </div>
    </div>

    <div class="checks">
      <span v-for="c in checks" :key="c.label" class="pill" :class="c.ok ? 'ok' : 'bad'" :title="c.detail">{{ c.ok ? '✓' : '✕' }} {{ c.label }}</span>
    </div>
    <div v-for="c in bad" :key="c.label" class="small bad">{{ c.detail }}</div>

    <div class="stats">
      <Stat label="Down" :value="`${bytes(v.speed?.down)}/s`" />
      <Stat label="Up" :value="`${bytes(v.speed?.up)}/s`" />
      <Stat label="Downloading" :value="t.downloading ?? 0" />
      <Stat label="Seeding" :value="t.seeding ?? 0" />
    </div>
    <div v-if="t.error" class="small bad">qBittorrent unreadable: {{ t.error }}</div>
    <div v-for="e in t.errored ?? []" :key="e" class="small bad">errored: {{ e }}</div>
  </Panel>
</template>

<style scoped>
.hero { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--ok-soft); }
.hero.warn { background: var(--warn-soft); } .hero.bad { background: var(--bad-soft); }
.hero b { font-size: 16px; }
.hero.ok b { color: var(--ok); } .hero.warn b { color: var(--warn); } .hero.bad b { color: var(--bad); }
.who { display: flex; flex-direction: column; min-width: 0; }
.who .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.checks { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 4px; }
.checks .pill { cursor: help; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
@media (max-width: 640px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
