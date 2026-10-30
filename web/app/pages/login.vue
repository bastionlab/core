<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'Locked · Bastion' })
const route = useRoute()
const pin = ref('')
const err = ref('')
const busy = ref(false)

async function submit() {
  if (!pin.value || busy.value) return
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { pin: pin.value } })
    useState('auth:ok').value = true
    useState('auth:role').value = null
    const next = String(route.query.next || '/')
    await navigateTo(next.startsWith('/') && !next.startsWith('//') ? next : '/')
  } catch (e: any) {
    err.value = e?.statusMessage || e?.data?.statusMessage || 'failed'
    pin.value = ''
  } finally {
    busy.value = false
  }
}
// accounts: name + password (+ code) or a passkey; the PIN pad stays for the owner's quick unlock
const { t } = useI18n()
const st = ref<{ configured: boolean, accounts: boolean, passkeys: boolean } | null>(null)
const mode = ref<'pin' | 'account' | 'invite'>('pin')
// an invite link (/login?invite=…): pick a name and password, signed in right away
const inviteTok = String(route.query.invite || '')
const inv = reactive({ role: '', gone: false, name: '', a: '', b: '' })
const acct = reactive({ name: '', password: '', code: '', needCode: false })
onMounted(async () => {
  if (inviteTok) {
    mode.value = 'invite'
    inv.role = (await $fetch<any>('/api/auth/invite', { query: { t: inviteTok } }).catch(() => null))?.role ?? ''
    inv.gone = !inv.role
    return
  }
  st.value = await $fetch<any>('/api/auth/status').catch(() => null)
  if (st.value?.accounts && (!st.value.configured || localStorage.getItem('login:mode') === 'account')) mode.value = 'account'
})
watch(mode, m => m !== 'invite' && localStorage.setItem('login:mode', m))
const done = async () => {
  useState('auth:ok').value = true
    useState('auth:role').value = null
  const next = String(route.query.next || '/')
  await navigateTo(next.startsWith('/') && !next.startsWith('//') ? next : '/')
}
async function signIn() {
  if (busy.value) return
  busy.value = true
  err.value = ''
  try {
    const r = await $fetch<any>('/api/auth/login', { method: 'POST', body: { name: acct.name, password: acct.password, code: acct.needCode ? acct.code : undefined } })
    if (r?.totp) { acct.needCode = true; return }
    await done()
  } catch (e: any) {
    err.value = e?.statusMessage || e?.data?.statusMessage || t('auth.failed')
    acct.code = ''
  } finally {
    busy.value = false
  }
}
async function join() {
  if (inv.a !== inv.b) { err.value = t('auth.pwDiffer'); return }
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/auth/invite', { method: 'POST', body: { t: inviteTok, name: inv.name, password: inv.a } })
    await done()
  } catch (e: any) {
    err.value = e?.statusMessage || e?.data?.statusMessage || t('auth.failed')
  } finally {
    busy.value = false
  }
}
async function withPasskey() {
  if (busy.value) return
  busy.value = true
  err.value = ''
  try {
    const o = await $fetch<any>('/api/auth/passkey')
    await $fetch('/api/auth/passkey', { method: 'POST', body: await passkeyGet(o) })
    await done()
  } catch (e: any) {
    if (e?.name !== 'NotAllowedError') err.value = e?.statusMessage || e?.data?.statusMessage || e?.message || t('auth.failed')
  } finally {
    busy.value = false
  }
}
const press = (d: string) => { if (pin.value.length < 12) pin.value += d; err.value = '' }
const back = () => (pin.value = pin.value.slice(0, -1))
// on a PC the number row / numpad works too: listen on the window, so focus never matters
function key(e: KeyboardEvent) {
  if (mode.value !== 'pin') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (/^\d$/.test(e.key)) press(e.key)
  else if (e.key === 'Backspace') back()
  else if (e.key === 'Escape') pin.value = ''
  else if (e.key === 'Enter') submit()
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', key))
onBeforeUnmount(() => window.removeEventListener('keydown', key))
</script>

<template>
  <div class="lock">
    <div v-if="mode !== 'invite' && st?.accounts && st.configured" class="seg modes">
      <button type="button" :class="{ on: mode === 'pin' }" @click="mode = 'pin'; err = ''">{{ $t('auth.pin') }}</button>
      <button type="button" :class="{ on: mode === 'account' }" @click="mode = 'account'; err = ''">{{ $t('auth.account') }}</button>
    </div>
    <form v-if="mode === 'invite'" class="card acct" @submit.prevent="join">
      <div class="icon"><Icon name="shield" :size="34"/></div>
      <b>{{ $t('auth.title') }}</b>
      <span v-if="inv.gone" class="err small">{{ $t('auth.inviteGone') }}</span>
      <template v-else-if="inv.role">
        <span class="small muted center">{{ $t('auth.invited', { role: $t(`users.role.${inv.role}`) }) }}</span>
        <input v-model="inv.name" autocomplete="username" autocapitalize="none" spellcheck="false" :placeholder="$t('auth.name')">
        <input v-model="inv.a" type="password" autocomplete="new-password" :placeholder="$t('auth.pwNew')">
        <input v-model="inv.b" type="password" autocomplete="new-password" :placeholder="$t('auth.pwRepeat')">
        <div class="err small">{{ err || ' ' }}</div>
        <button type="submit" class="btn primary wide" :disabled="busy || !inv.name || !inv.a || !inv.b">{{ $t('auth.join') }}</button>
      </template>
    </form>
    <form v-else-if="mode === 'account'" class="card acct" @submit.prevent="signIn">
      <div class="icon"><Icon name="shield" :size="34"/></div>
      <b>{{ $t('auth.title') }}</b>
      <template v-if="!acct.needCode">
        <input v-model="acct.name" class="inp" autocomplete="username" autocapitalize="none" spellcheck="false" :placeholder="$t('auth.name')">
        <input v-model="acct.password" class="inp" type="password" autocomplete="current-password" :placeholder="$t('auth.password')">
      </template>
      <template v-else>
        <span class="small muted">{{ $t('auth.codeHint') }}</span>
        <input v-model="acct.code" class="inp code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :placeholder="$t('auth.code')" autofocus>
      </template>
      <div class="err small">{{ err || ' ' }}</div>
      <button type="submit" class="btn primary wide" :disabled="busy || !acct.name || !acct.password">{{ $t('auth.signIn') }}</button>
      <template v-if="st?.passkeys && passkeysSupported()">
        <span class="faint small">{{ $t('auth.or') }}</span>
        <button type="button" class="btn wide" :disabled="busy" @click="withPasskey">{{ $t('auth.passkey') }}</button>
      </template>
    </form>
    <form v-else class="card" @submit.prevent="submit">
      <div class="icon"><Icon name="shield" :size="34"/></div>
      <b>{{ $t('auth.title') }}</b>
      <div class="dots" :class="{ shake: err }" role="status" :aria-label="`${pin.length} digits entered`">
        <span v-for="i in Math.max(4, pin.length)" :key="i" :class="{ on: i <= pin.length }" />
      </div>
      <div class="err small">{{ err || ' ' }}</div>
      <div class="pad">
        <button v-for="d in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="d" type="button" @click="press(d)">{{ d }}</button>
        <button type="button" class="fn" :disabled="!pin" title="delete" @click="back" aria-label="delete"><Icon name="x" :size="18"/></button>
        <button type="button" @click="press('0')">0</button>
        <button type="submit" class="fn go" :disabled="!pin || busy" :title="$t('auth.unlock')" :aria-label="$t('auth.unlock')"><Icon name="arrow" :size="18"/></button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.lock { min-height: 100dvh; display: grid; place-items: center; align-content: center; gap: 18px; background: var(--bg); padding: 16px; }
.card { display: flex; flex-direction: column; align-items: center; gap: 10px; width: min(300px, 100%); }
.icon { font-size: 34px; }
.dots { display: flex; gap: 12px; margin-top: 12px; min-height: 14px; }
.dots span { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--line-2); }
.dots span.on { background: var(--accent); border-color: var(--accent); }
.shake { animation: shake .3s; }
@keyframes shake { 25% { transform: translateX(-6px) } 75% { transform: translateX(6px) } }
.err { color: var(--bad); min-height: 18px; text-align: center; }
.pad { display: grid; grid-template-columns: repeat(3, 72px); gap: 12px; }
.pad button { width: 72px; height: 72px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: var(--panel); color: var(--text); font: inherit; font-size: 22px; cursor: pointer; }
.pad button:hover:not(:disabled) { background: var(--panel-2); }
.pad button:active:not(:disabled) { background: var(--line-2); }
.pad .fn { background: transparent; border-color: transparent; color: var(--muted); }
.pad .go:not(:disabled) { background: var(--accent); color: var(--bg); }
.pad button:disabled { opacity: .35; cursor: default; }
.modes { justify-self: center; }
.acct .inp { width: 100%; }
.acct .code { text-align: center; letter-spacing: .3em; font-size: 20px; }
.wide { width: 100%; justify-content: center; }
.center { text-align: center; }
.acct input { width: 100%; }
</style>
