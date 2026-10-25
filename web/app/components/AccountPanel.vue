<script setup lang="ts">
/**
 * Settings → Account: your own sign-in. Create the account (from a PIN session), change the password, passkeys
 * (only on the host name: browsers refuse them on an IP address), the TOTP code, sign out everywhere.
 * Server side: server/api/account, server/utils/users.ts.
 */
const { t } = useI18n()
const { toast } = useToast()
const a = ref<any>(null)
const load = async () => { a.value = await $fetch<any>('/api/account').catch(() => null) }
onMounted(load)

const busy = ref(false)
const err = ref('')
async function op(body: any, after?: () => void) {
  busy.value = true
  err.value = ''
  try {
    const r = await $fetch<any>('/api/account', { method: 'POST', body })
    after?.()
    await load()
    return r
  } catch (e: any) {
    err.value = e?.statusMessage || e?.data?.statusMessage || e?.message || t('auth.failed')
  } finally {
    busy.value = false
  }
}

const create = reactive({ name: '', a: '', b: '' })
function doCreate() {
  if (create.a !== create.b) { err.value = t('auth.pwDiffer'); return }
  op({ op: 'create', name: create.name, password: create.a }, () => Object.assign(create, { name: '', a: '', b: '' }))
}

const pwOpen = ref(false)
const pw = reactive({ current: '', a: '', b: '' })
function doPw() {
  if (pw.a !== pw.b) { err.value = t('auth.pwDiffer'); return }
  op({ op: 'password', current: pw.current, password: pw.a }, () => { Object.assign(pw, { current: '', a: '', b: '' }); pwOpen.value = false; toast(t('auth.saved')) })
}

const pkLabel = ref('')
async function addPasskey() {
  busy.value = true
  err.value = ''
  try {
    const o = await $fetch<any>('/api/account', { method: 'POST', body: { op: 'passkey-options' } })
    const credential = await passkeyCreate(o)
    busy.value = false
    await op({ op: 'passkey-add', credential, label: pkLabel.value }, () => (pkLabel.value = ''))
  } catch (e: any) {
    if (e?.name !== 'NotAllowedError') err.value = e?.statusMessage || e?.data?.statusMessage || e?.message || t('auth.failed')
  } finally {
    busy.value = false
  }
}
const { armed: rmArmed, arm: rmArm } = useArm()

const totp = ref<{ secret: string, uri: string } | null>(null)
const totpCode = ref('')
const totpPw = ref('')
const totpOffOpen = ref(false)
const totpStart = async () => { totp.value = await op({ op: 'totp-start' }) ?? null }
const totpConfirm = () => op({ op: 'totp-confirm', code: totpCode.value }, () => { totp.value = null; totpCode.value = '' })
const totpOff = () => op({ op: 'totp-off', password: totpPw.value }, () => { totpPw.value = ''; totpOffOpen.value = false })

const signoutAll = () => op({ op: 'signout-all' }, () => toast(t('auth.signoutAllDone')))
</script>

<template>
  <Panel id="account" :title="$t('auth.acct')" :sub="a?.user ? a.user.name : $t('auth.acctSub')" fold="phone">
    <Skeleton v-if="!a" kind="lines" :n="3" />

    <form v-else-if="!a.accounts" class="col" @submit.prevent="doCreate">
      <p class="small muted">{{ $t('auth.none') }}</p>
      <input v-model="create.name" autocomplete="username" autocapitalize="none" spellcheck="false" :placeholder="$t('auth.name')">
      <input v-model="create.a" type="password" autocomplete="new-password" :placeholder="$t('auth.pwNew')">
      <input v-model="create.b" type="password" autocomplete="new-password" :placeholder="$t('auth.pwRepeat')">
      <button type="submit" class="btn primary sm" :disabled="busy || !create.name || !create.a || !create.b">{{ $t('auth.create') }}</button>
    </form>

    <p v-else-if="!a.user" class="small muted">{{ $t('auth.pinSession') }}</p>

    <template v-else>
      <div class="row">
        <span class="small">{{ $t('auth.signedIn', { name: a.user.name }) }}</span>
        <button type="button" class="btn sm" @click="pwOpen = !pwOpen">{{ $t('auth.changePw') }}</button>
      </div>
      <form v-if="pwOpen" class="col" @submit.prevent="doPw">
        <input v-model="pw.current" type="password" autocomplete="current-password" :placeholder="$t('auth.pwCurrent')">
        <input v-model="pw.a" type="password" autocomplete="new-password" :placeholder="$t('auth.pwNew')">
        <input v-model="pw.b" type="password" autocomplete="new-password" :placeholder="$t('auth.pwRepeat')">
        <button type="submit" class="btn primary sm" :disabled="busy || !pw.current || !pw.a || !pw.b">{{ $t('auth.save') }}</button>
      </form>

      <h3 class="sub-h">{{ $t('auth.passkeys') }}</h3>
      <div v-if="!a.passkeys.length" class="faint small">{{ $t('auth.noPasskeys') }}</div>
      <div v-for="p in a.passkeys" :key="p.id" class="row">
        <div class="what">
          <b class="small">{{ p.label }}</b>
          <span class="faint small">{{ p.used ? $t('auth.lastUsed', { when: fmtDate(p.used) }) : $t('auth.never') }}</span>
        </div>
        <button type="button" class="lnk small bad" :class="{ sure: rmArmed === p.id }" @click="rmArm(p.id) && op({ op: 'passkey-delete', id: p.id })">{{ $t('auth.remove') }}</button>
      </div>
      <form v-if="a.passkeyHost && passkeysSupported()" class="inline" @submit.prevent="addPasskey">
        <input v-model="pkLabel" :placeholder="$t('auth.passkeyLabel')" maxlength="60">
        <button type="submit" class="btn sm" :disabled="busy">{{ $t('auth.addPasskey') }}</button>
      </form>
      <p v-else class="faint small">{{ $t('auth.passkeyNoHost') }}</p>

      <h3 class="sub-h">{{ $t('auth.totp') }}</h3>
      <template v-if="a.user.totp">
        <div class="row">
          <span class="small ok">{{ $t('auth.totpOn') }}</span>
          <button type="button" class="btn ghost sm" @click="totpOffOpen = !totpOffOpen">{{ $t('auth.turnOff') }}</button>
        </div>
        <form v-if="totpOffOpen" class="inline" @submit.prevent="totpOff">
          <input v-model="totpPw" type="password" autocomplete="current-password" :placeholder="$t('auth.pwCurrent')">
          <button type="submit" class="btn danger sm" :disabled="busy || !totpPw">{{ $t('auth.turnOff') }}</button>
        </form>
      </template>
      <div v-else-if="!totp" class="row">
        <span class="small muted">{{ $t('auth.totpOff') }}</span>
        <button type="button" class="btn sm" :disabled="busy" @click="totpStart">{{ $t('auth.totpSetup') }}</button>
      </div>
      <form v-else class="col" @submit.prevent="totpConfirm">
        <p class="small muted">{{ $t('auth.totpStep') }}</p>
        <code class="mono small key">{{ totp.secret }}</code>
        <a class="lnk small" :href="totp.uri">{{ $t('auth.openApp') }}</a>
        <input v-model="totpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :placeholder="$t('auth.code')">
        <button type="submit" class="btn primary sm" :disabled="busy || totpCode.length !== 6">{{ $t('auth.confirm') }}</button>
      </form>

      <div class="foot">
        <button type="button" class="btn ghost sm" :disabled="busy" @click="signoutAll">{{ $t('auth.signoutAll') }}</button>
      </div>
    </template>

    <div v-if="err" class="errbox small">{{ err }}</div>
  </Panel>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.col .btn { align-self: flex-start; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
.what { display: flex; flex-direction: column; min-width: 0; }
.inline { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.inline input { flex: 1 1 160px; }
.sub-h { font-size: 13px; color: var(--muted); font-weight: 600; margin: 14px 0 4px; }
.key { overflow-wrap: anywhere; background: var(--panel-2); padding: 6px 8px; border-radius: var(--radius-sm); }
.foot { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 12px; }
.errbox { margin-top: 10px; }
</style>
