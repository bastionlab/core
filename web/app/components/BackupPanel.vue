<script setup lang="ts">
/**
 * Settings → Backup: the dashboard's own backups (agent/dash-backup) — schedule, where, how many; the passphrase
 * the secrets are encrypted with; back up now, download, upload one from elsewhere, restore with a preview of
 * everything it replaces (backup_create / backup_restore, approve-then-Run).
 */
const { t } = useI18n()
const b = ref<any>(null)
const err = ref('')
async function load() {
  try { b.value = await $fetch('/api/backup') } catch (e: any) { err.value = errText(e) }
}
onMounted(load)

async function save(patch: any) {
  err.value = ''
  try { b.value = await $fetch('/api/backup/settings', { method: 'POST', body: { schedule: b.value.schedule, keep: b.value.keep, storage: b.value.storage, ...patch } }) } catch (e: any) { err.value = errText(e) }
}

// --- passphrase ------------------------------------------------------------------------------------------------
const passOpen = ref(false)
const pass = reactive({ a: '', b: '' })
const passErr = ref('')
async function savePass() {
  passErr.value = ''
  if (pass.a !== pass.b) { passErr.value = t('backup.passDiffer'); return }
  if (pass.a.length < 8) { passErr.value = t('backup.passShort'); return }
  try {
    await $fetch('/api/backup/pass', { method: 'POST', body: { pass: pass.a } })
    pass.a = pass.b = ''; passOpen.value = false; load()
  } catch (e: any) { passErr.value = errText(e) }
}

// --- now / upload / restore ----------------------------------------------------------------------------------------
const { jobs, run, dismiss } = useActions()
const backupNow = () => run('backup_create', {}, load)
const uploading = ref(false)
const file = ref<HTMLInputElement | null>(null)
async function upload(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  uploading.value = true; err.value = ''
  try {
    await $fetch('/api/backup/upload', { method: 'POST', query: { name: f.name }, body: f, headers: { 'content-type': 'application/gzip' }, timeout: 30 * 60_000 })
    await load()
  } catch (e: any) { err.value = errText(e) } finally { uploading.value = false; if (file.value) file.value.value = '' }
}

const preview = ref<any>(null)
const previewing = ref('')
const pending = ref('')
const armed = ref(false)
let armTimer: any
async function review(name: string) {
  err.value = ''; previewing.value = name; preview.value = null; pending.value = ''
  try {
    const [p, r] = await Promise.all([
      $fetch<any>('/api/backup/preview', { query: { name }, timeout: 300_000 }),
      $fetch<{ desc: string }>('/api/ai/action/check', { method: 'POST', body: { name: 'backup_restore', args: { name } } }),
    ])
    preview.value = p; pending.value = r.desc
    armed.value = false; clearTimeout(armTimer); armTimer = setTimeout(() => (armed.value = true), 2500)
  } catch (e: any) { err.value = errText(e) } finally { previewing.value = '' }
}
function restore() {
  if (!armed.value || !preview.value) return
  const name = preview.value.name
  preview.value = null; pending.value = ''
  run('backup_restore', { name })
}
onBeforeUnmount(() => clearTimeout(armTimer))

const sub = computed(() => !b.value ? '' : `${t('backup.count', b.value.list.length)} · ${t(`backup.${b.value.schedule}`)}`)
</script>

<template>
  <Panel id="backup" :title="$t('backup.title')" :sub="sub" fold="phone">
    <Skeleton v-if="!b && !err" kind="rows" :n="4" />
    <template v-if="b">
      <div class="kv">
        <span class="k small muted">{{ $t('backup.schedule') }}</span>
        <div class="seg">
          <button v-for="s in ['off', 'daily', 'weekly']" :key="s" type="button" :class="{ on: b.schedule === s }" @click="save({ schedule: s })">{{ $t(`backup.${s}`) }}</button>
        </div>
      </div>
      <div class="kv">
        <span class="k small muted">{{ $t('backup.keep') }}</span>
        <input type="number" min="1" max="100" class="num-in" :value="b.keep" @change="save({ keep: +($event.target as HTMLInputElement).value })">
      </div>
      <div class="kv">
        <span class="k small muted">{{ $t('backup.where') }}</span>
        <select :value="b.storage" @change="save({ storage: ($event.target as HTMLSelectElement).value })">
          <option value="">{{ $t('backup.defaultDir') }}</option>
          <option v-for="s in b.storages" :key="s" :value="s">{{ $t('backup.storage', { s }) }}</option>
        </select>
        <span class="faint small mono">{{ b.dir }}</span>
      </div>
      <div class="kv">
        <span class="k small muted">{{ $t('backup.secrets') }}</span>
        <span v-if="b.pass_set" class="small muted">{{ $t('backup.encrypted', { ago: ago(b.pass_updated) }) }}</span>
        <span v-else class="small warn">{{ $t('backup.noPass') }}</span>
        <button type="button" class="btn sm" @click="passOpen = !passOpen; passErr = ''">{{ b.pass_set ? $t('common.change') : $t('backup.setPass') }}</button>
        <form v-if="passOpen" class="pass" @submit.prevent="savePass">
          <input v-model="pass.a" type="password" autocomplete="new-password" :placeholder="$t('backup.passphrase')">
          <input v-model="pass.b" type="password" autocomplete="new-password" :placeholder="$t('backup.passAgain')">
          <div class="row">
            <button type="submit" class="btn primary sm" :disabled="!pass.a || !pass.b">{{ $t('common.save') }}</button>
            <span class="faint small">{{ b.pass_set ? $t('backup.passOld') : $t('backup.passKeep') }}</span>
          </div>
          <div v-if="passErr" class="errbox small">{{ passErr }}</div>
        </form>
      </div>

      <div class="row acts">
        <button type="button" class="btn primary sm" @click="backupNow">{{ $t('backup.now') }}</button>
        <button type="button" class="btn sm" :disabled="uploading" @click="file?.click()">{{ uploading ? $t('backup.uploading') : $t('backup.upload') }}</button>
        <input ref="file" type="file" accept=".gz,application/gzip" hidden @change="upload">
      </div>
      <JobList :jobs="jobs" @dismiss="dismiss" />

      <div v-if="!b.list.length" class="empty-state small">{{ $t('common.nothing') }}</div>
      <div v-for="x in b.list" :key="x.name" class="bk">
        <div class="what">
          <b class="small">{{ fmtDate(x.created, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</b>
          <span class="faint small">{{ bytes(x.size) }} · {{ x.host }}{{ x.core ? ` · v${x.core}` : '' }} · {{ x.secrets ? $t('backup.withSecrets') : $t('backup.noSecrets') }}</span>
        </div>
        <div class="btns">
          <a class="btn ghost sm" :href="`/api/backup/file/${x.name}`" :download="x.name">{{ $t('backup.download') }}</a>
          <button type="button" class="btn sm" :disabled="previewing === x.name" @click="review(x.name)">{{ previewing === x.name ? $t('common.checking') : $t('backup.restore') }}</button>
        </div>
        <div v-if="preview?.name === x.name" class="confirm">
          <p class="small"><b>{{ $t('backup.replaces') }}</b></p>
          <ul class="items small">
            <li v-for="i in preview.items" :key="i.id" :class="{ faint: !i.ok }">
              <span class="dot" :class="i.ok ? 'warn' : 'bad'" /> {{ i.what }} <span class="mono faint">{{ i.where }}</span>
              <span class="faint"> · {{ bytes(i.size) }}{{ i.now != null ? ` (${$t('backup.now_', { s: bytes(i.now) })})` : '' }}</span>
              <div v-if="i.note" class="faint">{{ i.note }}</div>
            </li>
          </ul>
          <p v-if="preview.core && preview.core !== preview.this_core" class="small warn">{{ $t('backup.otherCore', { v: preview.core, here: preview.this_core }) }}</p>
          <p class="small faint">{{ pending }}</p>
          <div class="row">
            <button type="button" class="btn danger sm" :disabled="!armed" @click="restore">{{ $t('common.run') }}</button>
            <button type="button" class="btn ghost sm" @click="preview = null">{{ $t('common.cancel') }}</button>
          </div>
        </div>
      </div>
    </template>
    <div v-if="err" class="errbox small">{{ err }}</div>
  </Panel>
</template>

<style scoped>
.kv { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
.kv:first-of-type { border-top: 0; }
.k { width: 110px; flex: none; }
.num-in { width: 80px; }
.pass { flex-basis: 100%; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.acts { padding: 12px 0 4px; border-top: 1px solid var(--line); }
.bk { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--line); }
.what { display: flex; flex-direction: column; min-width: 0; }
.btns { display: flex; gap: 6px; }
.confirm { grid-column: 1 / -1; border: 1px solid var(--warn); border-radius: var(--radius-sm); padding: 10px 12px; }
.confirm p { margin: 0 0 8px; }
.items { margin: 0 0 8px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.items .mono { overflow-wrap: anywhere; }
@media (max-width: 640px) { .k { width: 100%; } }
</style>
