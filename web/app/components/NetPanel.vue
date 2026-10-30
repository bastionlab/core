<script setup lang="ts">
/** Network throughput of the physical NIC (agent samples every 5 s, 10 min kept) + an on-demand speed test */
const props = defineProps<{ net?: any }>()

const mbit = (b: number) => `${(b * 8 / 1e6).toFixed(1)} Mbit/s`
const mb = (b: number) => `${(b / 1e6).toFixed(2)} MB/s`

const hist = computed<number[][]>(() => props.net?.history ?? [])
const max = computed(() => Math.max(1, ...hist.value.flat()))
function line(i: 0 | 1) {
  const h = hist.value
  if (h.length < 2) return ''
  return h.map((p, k) => `${(k / (h.length - 1) * 100).toFixed(2)},${(38 - p[i]! / max.value * 36).toFixed(2)}`).join(' ')
}

const testing = ref(false)
const err = ref('')
const result = ref<any>(null)
const last = computed(() => result.value ?? props.net?.speedtest)
async function test() {
  testing.value = true; err.value = ''
  try { result.value = await $fetch('/api/net/speedtest', { method: 'POST' }) }
  catch (e: any) { err.value = e?.data?.statusMessage || e?.message || 'Test failed' }
  finally { testing.value = false }
}
</script>

<template>
  <Panel id="net" :title="$t('home.throughput')" :sub="net?.iface">
    <template #actions>
      <button class="btn sm" :disabled="testing" @click="test">{{ testing ? 'Testing…' : 'Test speed' }}</button>
    </template>
    <Skeleton v-if="!net" kind="lines" />
    <template v-else>
      <div class="grid cols-2">
        <div v-for="(d, i) in [{ l: 'Down', v: net.down, c: 'var(--accent)' }, { l: 'Up', v: net.up, c: 'var(--ok)' }]" :key="d.l">
          <div class="muted small">{{ d.l }}</div>
          <div class="num">{{ mbit(d.v) }} <span class="faint small">{{ mb(d.v) }}</span></div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="40" style="display:block">
            <polyline :points="line(i as 0 | 1)" fill="none" :stroke="d.c" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
      <div v-if="last" class="muted small" style="margin-top:8px">{{ $t('home.lastSpeedtest', { mbit: last.mbit.toFixed(1) }) }} · {{ fmtDate(last.at * 1000, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}</div>
      <div v-if="err" class="errbox" style="margin-top:8px">{{ err }}</div>
    </template>
  </Panel>
</template>
