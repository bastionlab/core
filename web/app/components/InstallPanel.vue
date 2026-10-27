<script setup lang="ts">
/** this install's config.json, grouped and explained; each change goes through the approve-then-Run config_set action */
const props = defineProps<{ cfg: any }>()
const { t } = useI18n()
const pair = (v: any) => (Array.isArray(v) ? v.join('-') : v)
const c = computed(() => props.cfg ?? {})
const groups = computed(() => [
  { key: 'basics', rows: [
    { path: 'name', k: 'name', value: c.value.name },
    { path: 'tailnet', k: 'tailnet', value: c.value.tailnet },
    { path: 'owner_logins', k: 'logins', value: (c.value.owner_logins ?? []).join(', ') },
  ] },
  { key: 'network', rows: [
    { path: 'lan.subnet', k: 'subnet', value: c.value.lan?.subnet },
    { path: 'lan.host_ip', k: 'hostip', value: c.value.lan?.host_ip },
  ] },
  { key: 'devbox', rows: [
    { path: 'devbox.ids', k: 'dbids', value: pair(c.value.devbox?.ids) },
    { path: 'devbox.ips', k: 'dbips', value: pair(c.value.devbox?.ips) },
  ] },
  { key: 'market', rows: [
    { path: 'marketplace.auto_update', k: 'auto', toggle: true, value: c.value.marketplace?.auto_update === false ? 'off' : 'on' },
    { path: 'marketplace.share_installs', k: 'share', toggle: true, value: c.value.marketplace?.share_installs ? 'on' : 'off' },
    { path: 'marketplace.index', k: 'index', value: c.value.marketplace?.index },
    { path: 'marketplace.repo', k: 'repo', value: c.value.marketplace?.repo },
    { path: 'marketplace.counter', k: 'counter', value: c.value.marketplace?.counter || '' },
  ] },
])
const cts = computed(() => Object.entries(c.value.cts ?? {}) as [string, any][])

const { jobs, run, dismiss } = useActions()
const edit = ref<{ path: string, draft: string } | null>(null)
const pending = ref<{ path: string, value: string, desc: string } | null>(null)
const armed = ref(false)
const err = ref('')
let armTimer: any
function startEdit(path: string, value: any) { edit.value = { path, draft: String(value ?? '') }; pending.value = null; err.value = '' }
async function review(path = edit.value?.path, value = edit.value?.draft) {
  if (!path) return
  err.value = ''
  try {
    const r = await $fetch<{ desc: string }>('/api/ai/action/check', { method: 'POST', body: { name: 'config_set', args: { path, value } } })
    pending.value = { path, value: value ?? '', desc: r.desc }
    armed.value = false; clearTimeout(armTimer); armTimer = setTimeout(() => (armed.value = true), 1500)
  } catch (e: any) { err.value = e?.data?.statusMessage || e?.statusMessage || e?.message }
}
function apply() {
  const p = pending.value
  if (!p || !armed.value) return
  pending.value = null; edit.value = null
  run('config_set', { path: p.path, value: p.value })
}
onBeforeUnmount(() => clearTimeout(armTimer))
</script>

<template>
  <Panel id="general" :title="t('settings.gen.title')" :sub="t('settings.gen.sub')">
    <div v-if="pending" class="confirm">
      <p class="small">{{ pending.desc }}</p>
      <div class="row">
        <button type="button" class="btn primary sm" :disabled="!armed" @click="apply">{{ t('common.run') }}</button>
        <button type="button" class="btn ghost sm" @click="pending = null">{{ t('common.cancel') }}</button>
      </div>
    </div>
    <JobList :jobs="jobs" @dismiss="dismiss" />
    <div v-if="err" class="errbox small">{{ err }}</div>

    <section v-for="g in groups" :key="g.key" class="grp">
      <h3>{{ t(`settings.gen.${g.key}`) }}</h3>
      <div v-for="r in g.rows" :key="r.path" class="kv">
        <div class="lbl">
          <span>{{ t(`settings.gen.${r.k}`) }}</span>
          <span class="faint small">{{ t(`settings.gen.${r.k}_h`) }}</span>
        </div>
        <div v-if="r.toggle" class="seg">
          <button type="button" :class="{ on: r.value === 'on' }" @click="r.value !== 'on' && review(r.path, 'on')">{{ t('settings.on') }}</button>
          <button type="button" :class="{ on: r.value === 'off' }" @click="r.value !== 'off' && review(r.path, 'off')">{{ t('settings.off') }}</button>
        </div>
        <div v-else-if="edit?.path === r.path" class="ed">
          <input v-model="edit.draft" @keydown.enter="review()">
          <button type="button" class="btn primary sm" @click="review()">{{ t('settings.review') }}</button>
          <button type="button" class="btn ghost sm" @click="edit = null">{{ t('common.cancel') }}</button>
        </div>
        <button v-else type="button" class="val" @click="startEdit(r.path, r.value)">
          <span class="mono small">{{ r.value || '—' }}</span>
          <span class="lnk small">{{ t('settings.edit') }}</span>
        </button>
      </div>
    </section>

    <section class="grp">
      <h3>{{ t('settings.gen.cts') }}</h3>
      <p class="faint small hint">{{ t('settings.gen.cts_h') }}</p>
      <div v-for="[k, ct] in cts" :key="k" class="kv">
        <span class="lbl">{{ k }}</span>
        <div v-if="edit?.path === `cts.${k}.id` || edit?.path === `cts.${k}.ip`" class="ed">
          <input v-model="edit.draft" @keydown.enter="review()">
          <button type="button" class="btn primary sm" @click="review()">{{ t('settings.review') }}</button>
          <button type="button" class="btn ghost sm" @click="edit = null">{{ t('common.cancel') }}</button>
        </div>
        <div v-else class="ct">
          <button type="button" class="lnk small mono" @click="startEdit(`cts.${k}.id`, ct.id)">{{ `CT ${ct.id}` }}</button>
          <button type="button" class="lnk small mono" @click="startEdit(`cts.${k}.ip`, ct.ip)">{{ ct.ip }}</button>
        </div>
      </div>
    </section>
  </Panel>
</template>

<style scoped>
.grp + .grp { margin-top: 18px; }
h3 { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); margin: 0 0 4px; }
.hint { margin: 0 0 4px; }
.kv { display: flex; align-items: center; gap: 6px 14px; padding: 9px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
.lbl { display: flex; flex-direction: column; gap: 1px; flex: 1 1 200px; min-width: 0; font-size: 13px; }
.val { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; flex: 1 1 220px; justify-content: flex-end; min-width: 0; text-align: right; }
.val .mono { overflow-wrap: anywhere; }
.val:hover .lnk { text-decoration: underline; }
.ed { display: flex; gap: 8px; flex: 1 1 260px; flex-wrap: wrap; }
.ed input { flex: 1; min-width: 140px; }
.ct { display: flex; gap: 14px; }
.confirm { border: 1px solid var(--warn); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 10px; }
.confirm p { margin: 0 0 8px; }
.row { display: flex; gap: 8px; }
@media (max-width: 640px) { .val { justify-content: space-between; text-align: left; flex-basis: 100%; } }
@media (pointer: coarse) { .lnk { padding: 6px 4px; } }
</style>
