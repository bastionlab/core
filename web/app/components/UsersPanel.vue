<script setup lang="ts">
/**
 * Settings → Users (owner only): who has an account and which role, invite links, and whether other tailnet
 * people may reach the sign-in page. Rules per role: shared/utils/roles.ts; server: server/api/users.
 */
const { t } = useI18n()
const { toast } = useToast()
const d = ref<any>(null)
const load = async () => { d.value = await $fetch<any>('/api/users').catch(() => null) }
onMounted(load)
const me = useState<any>('auth:me', () => null)
onMounted(async () => { me.value ??= (await $fetch<any>('/api/account').catch(() => null))?.user })

const err = ref('')
const busy = ref(false)
async function op(body: any) {
  busy.value = true
  err.value = ''
  try {
    const r = await $fetch<any>('/api/users', { method: 'POST', body })
    await load()
    return r
  } catch (e: any) {
    err.value = e?.statusMessage || e?.data?.statusMessage || t('auth.failed')
  } finally {
    busy.value = false
  }
}

const roles = ['viewer', 'member', 'admin', 'owner'] as const
const inviteRole = ref<typeof roles[number]>('viewer')
const link = ref('')
async function invite() {
  const r = await op({ op: 'invite', role: inviteRole.value })
  if (r?.link) link.value = r.link
}
async function share() {
  try {
    if (navigator.share) await navigator.share({ title: 'Bastion', text: t('users.shareText'), url: link.value })
    else { await navigator.clipboard.writeText(link.value); toast(t('users.copied')) }
  } catch {}
}
const { armed, arm } = useArm()
</script>

<template>
  <Panel id="users" :title="$t('users.title')" :sub="d ? $t('users.sub', { n: d.users.length }) : ''" fold="phone">
    <Skeleton v-if="!d" kind="rows" :n="3" />
    <template v-else>
      <p v-if="!d.users.length" class="small muted">{{ $t('users.first') }}</p>
      <div v-for="u in d.users" :key="u.id" class="row">
        <div class="what">
          <b class="small">{{ u.name }}</b>
          <span class="faint small">{{ $t('users.keys', { n: u.passkeys }) }}{{ u.totp ? ' · ' + $t('users.code') : '' }}</span>
        </div>
        <select :value="u.role" :disabled="busy" @change="op({ op: 'role', id: u.id, role: ($event.target as HTMLSelectElement).value })">
          <option v-for="r in roles" :key="r" :value="r">{{ $t(`users.role.${r}`) }}</option>
        </select>
        <button v-if="u.id !== me?.id" type="button" class="lnk small bad" :class="{ sure: armed === `u${u.id}` }" @click="arm(`u${u.id}`) && op({ op: 'remove', id: u.id })">
          {{ armed === `u${u.id}` ? $t('users.sure') : $t('auth.remove') }}
        </button>
        <span v-else class="faint small">{{ $t('users.you') }}</span>
      </div>

      <h3 class="sub-h">{{ $t('users.invite') }}</h3>
      <div class="seg">
        <button v-for="r in roles" :key="r" type="button" :class="{ on: inviteRole === r }" @click="inviteRole = r; link = ''">{{ $t(`users.role.${r}`) }}</button>
      </div>
      <p class="faint small">{{ $t(`users.can.${inviteRole}`) }}</p>
      <div v-if="link" class="col">
        <code class="mono small key">{{ link }}</code>
        <div class="btns">
          <button type="button" class="btn primary sm" @click="share">{{ $t('users.share') }}</button>
          <span class="faint small">{{ $t('users.once') }}</span>
        </div>
      </div>
      <button v-else type="button" class="btn sm" :disabled="busy" @click="invite">{{ $t('users.makeLink') }}</button>

      <template v-if="d.invites.length">
        <h3 class="sub-h">{{ $t('users.open') }}</h3>
        <div v-for="i in d.invites" :key="i.id" class="row">
          <span class="small">{{ $t(`users.role.${i.role}`) }} · <span class="faint">{{ $t('users.until', { when: fmtDate(i.expires) }) }}</span></span>
          <button type="button" class="lnk small" @click="op({ op: 'invite-drop', id: i.id })">{{ $t('users.cancel') }}</button>
        </div>
      </template>

      <h3 class="sub-h">{{ $t('users.reach') }}</h3>
      <label class="tog small">
        <input type="checkbox" :checked="d.guests" :disabled="busy" @change="op({ op: 'guests', on: ($event.target as HTMLInputElement).checked })">
        {{ $t('users.guests') }}
      </label>
      <p class="faint small">{{ $t('users.guestsHint') }}</p>
    </template>
    <div v-if="err" class="errbox small">{{ err }}</div>
  </Panel>
</template>

<style scoped>
.row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); }
.row:first-of-type { border-top: 0; }
.what { display: flex; flex-direction: column; min-width: 0; }
.row select { width: auto; }
.sub-h { font-size: 13px; color: var(--muted); font-weight: 600; margin: 16px 0 6px; }
.seg { margin-bottom: 6px; }
.col { display: flex; flex-direction: column; gap: 8px; }
.btns { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.key { overflow-wrap: anywhere; background: var(--panel-2); padding: 6px 8px; border-radius: var(--radius-sm); }
.tog { display: flex; gap: 8px; align-items: center; }
.errbox { margin-top: 10px; }
</style>
