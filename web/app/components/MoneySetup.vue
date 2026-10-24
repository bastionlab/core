<script setup lang="ts">
/** Connections: Enable Banking app (once), bank consents (every ≤180 days), Trade Republic login (when TR drops the cookie). */
const props = defineProps<{ d: any }>()
const emit = defineEmits<{ changed: [] }>()

const setup = computed(() => props.d.setup)
const redirect = computed(() => `${location.origin}/money`)
const err = ref('')
const busy = ref('')

async function act(action: string, body: Record<string, any> = {}) {
  busy.value = action
  err.value = ''
  try { return await $fetch<any>('/api/money/action', { method: 'POST', body: { action, ...body } }) }
  catch (e: any) { err.value = e?.data?.statusMessage || e?.statusMessage || e?.message; return null }
  finally { busy.value = '' }
}

// Enable Banking app
const eb = reactive({ appId: '', keyPem: '', show: false })
async function pickPem(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) eb.keyPem = await f.text()
}
async function saveEb() {
  const r = await act('ebConfig', { appId: eb.appId, keyPem: eb.keyPem })
  if (r) { eb.keyPem = ''; eb.show = false; emit('changed') }
}

// bank consents
const aspsps = ref<any[]>([])
const q = ref('')
const picking = ref(false)
async function openPicker() {
  picking.value = !picking.value
  if (picking.value && !aspsps.value.length) aspsps.value = (await act('ebAspsps', { country: 'DE' })) ?? []
}
const QUICK = ['DKB', 'PayPal']
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  const list = aspsps.value.filter(a => !s || a.name.toLowerCase().includes(s))
  return list.sort((a, b) => Number(QUICK.some(x => b.name.includes(x))) - Number(QUICK.some(x => a.name.includes(x)))).slice(0, 30)
})
async function link(name: string) {
  const r = await act('ebLink', { aspsp: name })
  if (r?.url) location.href = r.url
}
const daysLeft = (iso?: string) => (iso ? Math.floor((Date.parse(iso) - Date.now()) / 86400000) : null)
const unlinkArm = ref('')
async function unlink(id: string) {
  if (unlinkArm.value !== id) { unlinkArm.value = id; setTimeout(() => unlinkArm.value === id && (unlinkArm.value = ''), 4000); return }
  await act('ebUnlink', { sessionId: id })
  emit('changed')
}

// Trade Republic
const tr = reactive({ phone: '', pin: '', code: '', edit: false })
const trState = computed(() => setup.value.tr_login?.state)
const trAcc = computed(() => props.d.accounts.find((a: any) => a.key === 'tr:cash'))
async function saveTr() {
  const r = await act('trConfig', { phone: tr.phone, pin: tr.pin })
  if (r) { tr.pin = ''; tr.edit = false; emit('changed') }
}
async function trLogin() { if (await act('trLogin')) emit('changed') }
async function trCode() { if (await act('trCode', { code: tr.code })) { tr.code = ''; emit('changed') } }
</script>

<template>
  <Panel title="Connections" id="money-setup" :fold="setup.eb && setup.tr && d.links.length ? 'closed' : 'open'">
    <p v-if="err" class="bad small">{{ err }}</p>

    <!-- Enable Banking -->
    <div class="blk">
      <div class="row">
        <b title="via Enable Banking (PSD2, free for your own accounts)">Banks</b>
        <button v-if="setup.eb" class="btn ghost sm" @click="eb.show = !eb.show">Change key</button>
      </div>
      <template v-if="!setup.eb || eb.show">
        <ol class="small muted steps">
          <li>Sign in at <a href="https://enablebanking.com/cp/applications" target="_blank" rel="noopener">enablebanking.com</a> → <i>Applications</i> → <i>Add application</i>, environment <b>Production</b>, “Generate in browser” – the <code>.pem</code> gets downloaded.</li>
          <li>Enter the redirect URL: <code class="sel">{{ redirect }}</code></li>
          <li>On the app page, <i>Link accounts</i> for DKB and PayPal (that is the free “restricted” mode).</li>
          <li>Enter the app ID and <code>.pem</code> here:</li>
        </ol>
        <div class="form">
          <input v-model="eb.appId" placeholder="Application ID (UUID)" autocomplete="off">
          <label class="btn ghost file">Choose .pem<input type="file" accept=".pem,.key,.txt" @change="pickPem"></label>
          <textarea v-model="eb.keyPem" rows="3" placeholder="-----BEGIN PRIVATE KEY----- … (or choose a file)" spellcheck="false" />
          <button class="btn primary" :disabled="!eb.appId || !eb.keyPem || !!busy" @click="saveEb">{{ busy === 'ebConfig' ? 'checking…' : 'Save' }}</button>
        </div>
      </template>

      <template v-if="setup.eb">
        <div v-for="l in d.links" :key="l.session_id" class="item">
          <span class="dot" :class="(daysLeft(l.valid_until) ?? 99) < 0 ? 'bad' : (daysLeft(l.valid_until) ?? 99) < 8 ? 'warn' : 'ok'" />
          <b>{{ l.aspsp }}</b>
          <span class="small" :class="(daysLeft(l.valid_until) ?? 99) < 8 ? 'warn' : 'faint'">
            {{ (daysLeft(l.valid_until) ?? 0) < 0 ? 'expired' : `access for ${daysLeft(l.valid_until)} more days` }}
          </span>
          <span class="acts">
            <button class="btn ghost sm" :disabled="!!busy" @click="link(l.aspsp)">Renew</button>
            <button class="btn ghost sm" :class="{ danger: unlinkArm === l.session_id }" @click="unlink(l.session_id)">{{ unlinkArm === l.session_id ? 'Really disconnect?' : 'Disconnect' }}</button>
          </span>
        </div>
        <button class="btn sm add" @click="openPicker">+ Connect bank / PayPal</button>
        <div v-if="picking" class="picker">
          <input v-model="q" placeholder="Search banks…">
          <div v-if="busy === 'ebAspsps'" class="faint small">Loading banks…</div>
          <button v-for="a in shown" :key="a.name" class="bank" :disabled="!!busy" @click="link(a.name)">
            <img v-if="a.logo" :src="a.logo" alt="">{{ a.name }}
          </button>
          <div v-if="aspsps.length && !shown.length" class="faint small">Nothing found</div>
        </div>
      </template>
    </div>

    <!-- Trade Republic -->
    <div class="blk">
      <div class="row">
        <b title="unofficial via pytr · login = one tap in the TR app">Trade Republic</b>
        <button v-if="setup.tr" class="btn ghost sm" @click="tr.edit = !tr.edit">Change login</button>
      </div>
      <div v-if="!setup.tr || tr.edit" class="form">
        <input v-model="tr.phone" placeholder="Phone number +49…" inputmode="tel" autocomplete="off">
        <input v-model="tr.pin" placeholder="TR PIN (4 digits)" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
        <button class="btn primary" :disabled="!tr.phone || !tr.pin || !!busy" @click="saveTr">Save & log in</button>
      </div>
      <div v-else class="item">
        <span class="dot" :class="trState === 'waiting_app' || trState === 'need_code' ? 'warn' : trAcc?.error ? 'bad' : trAcc?.last_sync ? 'ok' : ''" />
        <span v-if="trState === 'waiting_app'" class="warn small">Confirm in the Trade Republic app now…</span>
        <span v-else-if="trState === 'need_code'" class="small inl">
          Code from your authenticator app:
          <input v-model="tr.code" inputmode="numeric" maxlength="8" class="code">
          <button class="btn primary sm" :disabled="!tr.code" @click="trCode">OK</button>
        </span>
        <span v-else-if="trState === 'error'" class="bad small">{{ setup.tr_login.error }}</span>
        <span v-else-if="trAcc?.error" class="bad small">{{ trAcc.error }}</span>
        <span v-else class="faint small">{{ trAcc?.last_sync ? `connected · ${ago(trAcc.last_sync)}` : 'set up – waiting for first sync' }}</span>
        <span class="acts"><button class="btn ghost sm" :disabled="trState === 'waiting_app' || !!busy" @click="trLogin">Log in again</button></span>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
.blk { border-top: 1px solid var(--line); padding: 12px 0; }
.blk:first-of-type { border-top: 0; padding-top: 0; }
.row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.row .btn { margin-left: auto; }
.steps { margin: 4px 0 10px; padding-left: 18px; line-height: 1.6; }
.sel { user-select: all; }
.form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.form input { flex: 1 1 180px; }
.form textarea { flex: 1 1 100%; font-family: var(--mono); font-size: 12px; }
.file { position: relative; overflow: hidden; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.item { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; }
.acts { margin-left: auto; display: flex; gap: 6px; }
.add { margin-top: 6px; }
.picker { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; max-height: 320px; overflow: auto; }
.bank { display: flex; align-items: center; gap: 8px; text-align: left; padding: 7px 10px; border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--panel-2); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; }
.bank:hover { border-color: var(--accent); }
.bank img { width: 20px; height: 20px; object-fit: contain; border-radius: 4px; background: #fff; }
.inl { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.code { width: 90px; }
.warn { color: var(--warn); }
@media (max-width: 640px) { .form input { flex-basis: 100%; } }
</style>
