<script setup lang="ts">
/**
 * Settings → Secrets: every key file on pve (where, what uses it, set or not, age; never the value), the PIN
 * change and the internal-token rotation (approve-then-Run, secrets_rotate).
 */
const props = defineProps<{ list: any[] | undefined }>()
const emit = defineEmits<{ changed: [] }>()

const tone = (r: any) => (!r.set ? 'bad' : r.old ? 'warn' : 'ok')
const old = computed(() => (props.list ?? []).filter(r => !r.set || r.old).length)
/** where a row is changed: on this panel, or the section of this page that owns it */
const link = (r: any) => r.rotate === 'github_token' || r.rotate === 'tailscale_authkey' ? '#connections'
  : r.rotate === 'discord' ? '#discord' : r.rotate?.startsWith('addon:') ? `#${r.rotate.slice(6)}` : ''

// --- PIN ---------------------------------------------------------------------------------------------------
const pinOpen = ref(false)
const pin = reactive({ current: '', a: '', b: '' })
const pinErr = ref('')
const pinBusy = ref(false)
const pinDone = ref(false)
async function savePin() {
  pinErr.value = ''
  if (pin.a !== pin.b) { pinErr.value = 'New PINs differ'; return }
  if (!/^[0-9]{4,12}$/.test(pin.a)) { pinErr.value = '4-12 digits'; return }
  pinBusy.value = true
  try {
    await $fetch('/api/settings/pin', { method: 'POST', body: { current: pin.current, new: pin.a } })
    pinDone.value = true; pinOpen.value = false
    pin.current = pin.a = pin.b = ''
    // the app restarts with the new hash; the next request asks for the PIN again
    setTimeout(() => location.reload(), 6000)
  } catch (e: any) { pinErr.value = e?.data?.statusMessage || e?.statusMessage || e?.message } finally { pinBusy.value = false }
}

// --- rotate internal tokens ----------------------------------------------------------------------------------
const { jobs, run, dismiss } = useActions()
const pending = ref('')
const armed = ref(false)
const rotErr = ref('')
let armTimer: any
async function review() {
  rotErr.value = ''
  try {
    const r = await $fetch<{ desc: string }>('/api/ai/action/check', { method: 'POST', body: { name: 'secrets_rotate', args: {} } })
    pending.value = r.desc
    armed.value = false; clearTimeout(armTimer); armTimer = setTimeout(() => (armed.value = true), 1500)
  } catch (e: any) { rotErr.value = e?.data?.statusMessage || e?.statusMessage || e?.message }
}
function apply() {
  if (!armed.value) return
  pending.value = ''
  run('secrets_rotate', {})
  emit('changed')
}
onBeforeUnmount(() => clearTimeout(armTimer))
</script>

<template>
  <Panel id="secrets" title="Secrets" :sub="!list ? '' : old ? `${old} need you` : `${list.length} keys`" fold="phone">
    <div v-if="!list" class="faint small">Loading…</div>
    <div v-for="r in list ?? []" :key="r.where + r.name" class="row">
      <span class="dot" :class="tone(r)" />
      <div class="what">
        <b>{{ r.name }}</b>
        <span class="faint small">{{ r.used_by }}</span>
        <span class="faint small mono where">{{ r.where }}</span>
      </div>
      <span class="small" :class="tone(r) === 'ok' ? 'muted' : tone(r)">{{ r.set ? (r.updated ? ago(r.updated) : 'set') : 'not set' }}</span>
      <div class="act">
        <button v-if="r.rotate === 'pin'" type="button" class="btn sm" @click="pinOpen = !pinOpen; pinErr = ''">Change</button>
        <a v-else-if="link(r)" class="lnk small" :href="link(r)">Open</a>
      </div>
      <form v-if="r.rotate === 'pin' && pinOpen" class="pin" @submit.prevent="savePin">
        <input v-model="pin.current" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Current PIN">
        <input v-model="pin.a" type="password" inputmode="numeric" autocomplete="new-password" placeholder="New PIN">
        <input v-model="pin.b" type="password" inputmode="numeric" autocomplete="new-password" placeholder="New PIN again">
        <div class="btns">
          <button type="submit" class="btn primary sm" :disabled="pinBusy || !pin.current || !pin.a || !pin.b">Save</button>
          <button type="button" class="btn ghost sm" @click="pinOpen = false">Cancel</button>
          <span class="faint small">Logs out every browser.</span>
        </div>
        <div v-if="pinErr" class="errbox small">{{ pinErr }}</div>
      </form>
      <div v-if="r.rotate === 'pin' && pinDone" class="pin ok small">PIN changed. Reloading…</div>
    </div>

    <div class="rot">
      <div v-if="pending" class="confirm">
        <p class="small">{{ pending }}</p>
        <div class="btns">
          <button type="button" class="btn primary sm" :disabled="!armed" @click="apply">Run</button>
          <button type="button" class="btn ghost sm" @click="pending = ''">Cancel</button>
        </div>
      </div>
      <button v-else type="button" class="btn sm" @click="review">Rotate internal tokens</button>
      <div v-if="rotErr" class="errbox small">{{ rotErr }}</div>
      <JobList :jobs="jobs" @dismiss="dismiss" />
    </div>
  </Panel>
</template>

<style scoped>
.row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 4px 10px; padding: 9px 0; border-top: 1px solid var(--line); }
.row:first-of-type { border-top: 0; }
.what { display: flex; flex-direction: column; min-width: 0; }
.where { overflow-wrap: anywhere; }
.act { justify-self: end; }
.pin { grid-column: 2 / -1; display: flex; flex-direction: column; gap: 8px; }
.btns { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rot { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 4px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.confirm { border: 1px solid var(--warn); border-radius: var(--radius-sm); padding: 10px 12px; align-self: stretch; }
.confirm p { margin: 0 0 8px; }
@media (pointer: coarse) { .lnk { padding: 6px 4px; } }
</style>
