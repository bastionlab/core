<script setup lang="ts">
const props = defineProps<{ vpn: any }>()
const v = computed(() => props.vpn ?? {})
/** one verdict from the four things that have to be true at once */
const checks = computed(() => [
  { ok: !!v.value.up, label: 'Tunnel up', detail: v.value.health ?? (v.value.up ? 'running' : 'gluetun is not running') },
  { ok: !!v.value.killSwitch, label: 'Kill switch armed', detail: v.value.killSwitch ? 'OUTPUT policy DROP — nothing leaves except through the tunnel' : 'OUTPUT policy is not DROP' },
  { ok: !!v.value.ip && !v.value.leaking, label: 'Traffic hidden', detail: v.value.ip ? (v.value.leaking ? `qBittorrent shows your home IP ${v.value.homeIp}` : `qBittorrent shows ${v.value.ip}, not ${v.value.homeIp ?? 'your home IP'}`) : 'no exit IP reported' },
  { ok: !!v.value.portOk, label: 'Port forwarded', detail: v.value.forwardedPort ? `${v.value.forwardedPort} → qBittorrent ${v.value.listenPort ?? '?'}${v.value.portOk ? '' : ' (out of sync — no incoming peers)'}` : 'no forwarded port' },
])
const bad = computed(() => checks.value.filter(c => !c.ok))
const verdict = computed(() => {
  if (v.value.leaking || !v.value.killSwitch) return { tone: 'bad', text: 'Not safe' }
  if (!v.value.up) return { tone: 'bad', text: 'Tunnel down' }
  if (bad.value.length) return { tone: 'warn', text: 'Protected, with a niggle' }
  return { tone: 'ok', text: 'Protected' }
})
</script>

<template>
  <Panel id="vpn" title="VPN" sub="every torrent goes through gluetun or nowhere">
    <div class="hero" :class="verdict.tone">
      <span class="shield">{{ verdict.tone === 'ok' ? '🛡️' : verdict.tone === 'warn' ? '⚠️' : '🚨' }}</span>
      <div>
        <b>{{ verdict.text }}</b>
        <div class="small muted">
          exit {{ v.ip ?? '–' }}<template v-if="v.city || v.country"> · {{ [v.city, v.country].filter(Boolean).join(', ') }}</template>
          <template v-if="v.org"> · {{ v.org.replace(/^AS\d+ /, '') }}</template>
        </div>
      </div>
      <div v-if="v.speed" class="speeds small">
        <span class="ok">↓ {{ bytes(v.speed.down) }}/s</span>
        <span class="muted">↑ {{ bytes(v.speed.up) }}/s</span>
      </div>
    </div>

    <ul class="checks">
      <li v-for="c in checks" :key="c.label">
        <span class="dot" :class="c.ok ? 'ok' : 'bad'" />
        <div><b>{{ c.label }}</b><div class="small muted">{{ c.detail }}</div></div>
      </li>
    </ul>

    <div class="faint small foot">
      Home IP {{ v.homeIp ?? '–' }} — it must never be what qBittorrent reports.
      <template v-if="v.speed"> Session: {{ bytes(v.speed.downTotal) }} down, {{ bytes(v.speed.upTotal) }} up.</template>
    </div>
  </Panel>
</template>

<style scoped>
.hero { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 9px; background: var(--ok-soft); margin-bottom: 14px; }
.hero.warn { background: var(--warn-soft); } .hero.bad { background: var(--bad-soft); }
.hero b { font-size: 16px; }
.shield { font-size: 26px; }
.speeds { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; white-space: nowrap; }
.checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.checks li { display: flex; gap: 10px; align-items: flex-start; }
.checks .dot { margin-top: 5px; }
.foot { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--line); }
</style>
