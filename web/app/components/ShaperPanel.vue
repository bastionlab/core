<script setup lang="ts">
/** Internet limits + priorities per container (tc/HTB on the host NIC). Mbit/s, 0 = no limit. LAN traffic is never shaped. */
const st = ref<any>(null)
const busy = ref(false)
const msg = ref('')
async function load() { st.value = await $fetch('/api/net/shaper', { method: 'POST', body: {} }) }
onMounted(load)
const row = (k: string) => (st.value.cts[k] ??= { prio: 4, down: 0, up: 0 })
async function save() {
  busy.value = true; msg.value = ''
  try { st.value = await $fetch('/api/net/shaper', { method: 'POST', body: { enabled: st.value.enabled, down: st.value.down, up: st.value.up, cts: st.value.cts } }); msg.value = 'Applied' }
  catch (e: any) { msg.value = e?.data?.statusMessage || e?.message || 'Failed' }
  finally { busy.value = false }
}
const prios = [[1, 'Highest'], [2, 'High'], [3, 'Above normal'], [4, 'Normal'], [5, 'Below normal'], [6, 'Low'], [7, 'Lowest']]
</script>

<template>
  <Panel id="shaper" title="Bandwidth limits" :sub="st?.active ? 'active' : 'off'">
    <Skeleton v-if="!st" kind="lines" />
    <template v-else>
      <div class="sh-head">
        <button class="sh-sw" :class="{ on: st.enabled }" role="switch" :aria-checked="st.enabled" @click="st.enabled = !st.enabled"><i /></button>
        <div>
          <div>Limit and prioritise internet traffic</div>
          <div class="muted small">Set the total to what your line really gives. Local network traffic is never limited.</div>
        </div>
      </div>
      <div class="sh-tot">
        <label class="sh-f"><span>Total down</span><div><input v-model.number="st.down" type="number" min="0" inputmode="numeric"><em>Mbit/s</em></div></label>
        <label class="sh-f"><span>Total up</span><div><input v-model.number="st.up" type="number" min="0" inputmode="numeric"><em>Mbit/s</em></div></label>
      </div>
      <div class="sh-list">
        <div v-for="t in st.targets" :key="t.key" class="sh-row" :class="{ set: row(t.key).down || row(t.key).up || row(t.key).prio !== 4 }">
          <div class="sh-name"><b>{{ t.key }}</b><span class="faint small">CT {{ t.id }} · {{ t.ip }}</span></div>
          <div class="sh-ctl">
            <label class="sh-f"><span>Priority</span>
              <select v-model.number="row(t.key).prio"><option v-for="p in prios" :key="p[0]" :value="p[0]">{{ p[1] }}</option></select>
            </label>
            <label class="sh-f"><span>Down max</span><div><input v-model.number="row(t.key).down" type="number" min="0" inputmode="numeric" placeholder="no limit"><em>Mbit</em></div></label>
            <label class="sh-f"><span>Up max</span><div><input v-model.number="row(t.key).up" type="number" min="0" inputmode="numeric" placeholder="no limit"><em>Mbit</em></div></label>
          </div>
        </div>
      </div>
      <div class="sh-foot">
        <button class="btn primary" :disabled="busy" @click="save">{{ busy ? 'Applying…' : 'Save and apply' }}</button>
        <span class="muted small">{{ msg }}</span>
      </div>
    </template>
  </Panel>
</template>

<style scoped>
.sh-head { display: flex; gap: 12px; align-items: center; }
.sh-sw { flex: none; width: 42px; height: 24px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--track); padding: 0; cursor: pointer; position: relative; transition: background .15s; }
.sh-sw i { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--muted); transition: transform .15s, background .15s; }
.sh-sw.on { background: var(--accent-soft); border-color: var(--accent); }
.sh-sw.on i { transform: translateX(18px); background: var(--accent); }
.sh-tot { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
.sh-f { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.sh-f > span { font-size: 11.5px; color: var(--muted); }
.sh-f > div { position: relative; }
.sh-f input, .sh-f select { width: 100%; box-sizing: border-box; }
.sh-f input { padding-right: 52px; }
.sh-f em { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-style: normal; font-size: 11.5px; color: var(--faint); pointer-events: none; }
.sh-list { display: flex; flex-direction: column; gap: 8px; }
.sh-row { background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px 12px; display: grid; gap: 10px; }
.sh-row.set { border-color: var(--accent); }
.sh-name { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.sh-ctl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.sh-foot { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
@media (max-width: 560px) { .sh-ctl { grid-template-columns: 1fr 1fr; } .sh-ctl > :first-child { grid-column: 1 / -1; } }
</style>
