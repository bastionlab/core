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
  <Panel title="Verbindungen" id="money-setup" :fold="setup.eb && setup.tr && d.links.length ? 'closed' : 'open'">
    <p v-if="err" class="bad small">{{ err }}</p>

    <!-- Enable Banking -->
    <div class="blk">
      <div class="row">
        <b>Banken</b>
        <span class="faint small">über Enable Banking (PSD2, kostenlos für eigene Konten)</span>
        <button v-if="setup.eb" class="btn ghost sm" @click="eb.show = !eb.show">Schlüssel ändern</button>
      </div>
      <template v-if="!setup.eb || eb.show">
        <ol class="small muted steps">
          <li>Auf <a href="https://enablebanking.com/cp/applications" target="_blank" rel="noopener">enablebanking.com</a> anmelden → <i>Applications</i> → <i>Add application</i>, Umgebung <b>Production</b>, „Generate in browser“ – die <code>.pem</code> wird heruntergeladen.</li>
          <li>Redirect-URL eintragen: <code class="sel">{{ redirect }}</code></li>
          <li>In der App-Seite <i>Link accounts</i> für DKB und PayPal (das ist der kostenlose „restricted“ Modus).</li>
          <li>App-ID und <code>.pem</code> hier eintragen:</li>
        </ol>
        <div class="form">
          <input v-model="eb.appId" placeholder="Application ID (UUID)" autocomplete="off">
          <label class="btn ghost file">.pem wählen<input type="file" accept=".pem,.key,.txt" @change="pickPem"></label>
          <textarea v-model="eb.keyPem" rows="3" placeholder="-----BEGIN PRIVATE KEY----- … (oder Datei wählen)" spellcheck="false" />
          <button class="btn primary" :disabled="!eb.appId || !eb.keyPem || !!busy" @click="saveEb">{{ busy === 'ebConfig' ? 'prüfe…' : 'Speichern' }}</button>
        </div>
      </template>

      <template v-if="setup.eb">
        <div v-for="l in d.links" :key="l.session_id" class="item">
          <span class="dot" :class="(daysLeft(l.valid_until) ?? 99) < 0 ? 'bad' : (daysLeft(l.valid_until) ?? 99) < 8 ? 'warn' : 'ok'" />
          <b>{{ l.aspsp }}</b>
          <span class="small" :class="(daysLeft(l.valid_until) ?? 99) < 8 ? 'warn' : 'faint'">
            {{ (daysLeft(l.valid_until) ?? 0) < 0 ? 'abgelaufen' : `Zugriff noch ${daysLeft(l.valid_until)} Tage` }}
          </span>
          <span class="acts">
            <button class="btn ghost sm" :disabled="!!busy" @click="link(l.aspsp)">erneuern</button>
            <button class="btn ghost sm" :class="{ danger: unlinkArm === l.session_id }" @click="unlink(l.session_id)">{{ unlinkArm === l.session_id ? 'wirklich trennen?' : 'trennen' }}</button>
          </span>
        </div>
        <button class="btn sm add" @click="openPicker">+ Bank / PayPal verbinden</button>
        <div v-if="picking" class="picker">
          <input v-model="q" placeholder="Bank suchen…">
          <div v-if="busy === 'ebAspsps'" class="faint small">lade Banken…</div>
          <button v-for="a in shown" :key="a.name" class="bank" :disabled="!!busy" @click="link(a.name)">
            <img v-if="a.logo" :src="a.logo" alt="">{{ a.name }}
          </button>
          <div v-if="aspsps.length && !shown.length" class="faint small">nichts gefunden</div>
        </div>
      </template>
    </div>

    <!-- Trade Republic -->
    <div class="blk">
      <div class="row">
        <b>Trade Republic</b>
        <span class="faint small">inoffiziell über pytr · Login = ein Tipp in der TR-App</span>
        <button v-if="setup.tr" class="btn ghost sm" @click="tr.edit = !tr.edit">Zugang ändern</button>
      </div>
      <div v-if="!setup.tr || tr.edit" class="form">
        <input v-model="tr.phone" placeholder="Handynummer +49…" inputmode="tel" autocomplete="off">
        <input v-model="tr.pin" placeholder="TR-PIN (4 Ziffern)" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
        <button class="btn primary" :disabled="!tr.phone || !tr.pin || !!busy" @click="saveTr">Speichern & einloggen</button>
      </div>
      <div v-else class="item">
        <span class="dot" :class="trState === 'waiting_app' || trState === 'need_code' ? 'warn' : trAcc?.error ? 'bad' : trAcc?.last_sync ? 'ok' : ''" />
        <span v-if="trState === 'waiting_app'" class="warn small">Bitte jetzt in der Trade-Republic-App bestätigen…</span>
        <span v-else-if="trState === 'need_code'" class="small inl">
          Code aus deiner Authenticator-App:
          <input v-model="tr.code" inputmode="numeric" maxlength="8" class="code">
          <button class="btn primary sm" :disabled="!tr.code" @click="trCode">OK</button>
        </span>
        <span v-else-if="trState === 'error'" class="bad small">{{ setup.tr_login.error }}</span>
        <span v-else-if="trAcc?.error" class="bad small">{{ trAcc.error }}</span>
        <span v-else class="faint small">{{ trAcc?.last_sync ? `verbunden · ${ago(trAcc.last_sync)}` : 'eingerichtet – wartet auf ersten Sync' }}</span>
        <span class="acts"><button class="btn ghost sm" :disabled="trState === 'waiting_app' || !!busy" @click="trLogin">neu einloggen</button></span>
      </div>
    </div>
    <p class="faint small">Zugangsdaten liegen nur in CT 108 (/etc/money, root-only) und werden nie zurückgegeben. Läuft ein Zugriff bald ab, kommt eine Nachricht in Discord #alerts.</p>
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
.form textarea { flex: 1 1 100%; font-family: var(--mono); font-size: 11px; }
.file { position: relative; overflow: hidden; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.item { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; }
.acts { margin-left: auto; display: flex; gap: 6px; }
.sm { padding: 3px 9px; font-size: 12px; }
.add { margin-top: 6px; }
.picker { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; max-height: 320px; overflow: auto; }
.bank { display: flex; align-items: center; gap: 8px; text-align: left; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel-2); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; }
.bank:hover { border-color: var(--accent); }
.bank img { width: 20px; height: 20px; object-fit: contain; border-radius: 4px; background: #fff; }
.inl { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.code { width: 90px; }
.warn { color: var(--warn); }
</style>
