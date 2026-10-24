<script setup lang="ts">
/**
 * One place for everything that's configured: every outside connection (the core's and each add-on's) with its
 * status, every secret on pve (PIN change, token rotation), this install's config.json, Discord, and a section per add-on built from its addon.yaml `settings:`
 * (+ its own Settings<Id>.global.vue when it has a flow of its own, like Money's bank logins).
 */
useHead({ title: 'Settings · pve' })
const { data: s, refresh, error } = useFetch<any>('/api/settings', { server: false })
const { list, pageOn, load } = useAddons()
onMounted(load)
const on = computed(() => list.filter(a => !a.routes[0] || pageOn(a.routes[0])))
const pascal = (id: string) => id.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join('')

// --- connections: the core's (from the agent) + each switched-on add-on's own list --------------------------
const extra = ref<Record<string, any[]>>({})
async function loadExtra() {
  const got = await Promise.all(on.value.filter(a => a.connections).map(async a => [a.id, await $fetch<any[]>(a.connections!).catch((e: any) => [{ id: 'x', name: a.name, ok: false, detail: `no answer (${e?.statusMessage || e?.message})` }])] as const))
  extra.value = Object.fromEntries(got)
}
onMounted(loadExtra)
const rows = computed(() => [
  ...(s.value?.connections ?? []).map((c: any) => ({ ...c, addon: null })),
  ...on.value.flatMap(a => (extra.value[a.id] ?? []).map((c: any) => ({ ...c, addon: a, key: `${a.id}:${c.id}` }))),
])
const tone = (c: any) => (!c.ok ? 'bad' : c.warn ? 'warn' : 'ok')
const problems = computed(() => rows.value.filter(c => !c.ok || c.warn).length)
/** where the owner fixes a connection: an inline key field, a section on this page, or a hint */
const hasSection = (a: any) => a && (a.settingsUi || s.value?.addons?.[a.id])

const replacing = ref('')
const keyDraft = ref('')
const keyErr = ref('')
async function saveKey(key: string) {
  keyErr.value = ''
  try {
    await $fetch('/api/settings/core', { method: 'POST', body: { key, value: keyDraft.value } })
    replacing.value = ''; keyDraft.value = ''; refresh()
  } catch (e: any) { keyErr.value = e?.data?.statusMessage || e?.statusMessage || e?.message }
}

// --- general: config.json, one value at a time through the approve-then-Run action --------------------------
const cfg = computed(() => s.value?.config ?? {})
const pair = (v: any) => (Array.isArray(v) ? v.join('-') : v)
const general = computed(() => [
  { path: 'name', label: 'Name', value: cfg.value.name },
  { path: 'tailnet', label: 'Tailnet', value: cfg.value.tailnet },
  { path: 'owner_logins', label: 'Tailscale logins', value: (cfg.value.owner_logins ?? []).join(', ') },
  { path: 'lan.subnet', label: 'LAN', value: cfg.value.lan?.subnet },
  { path: 'lan.host_ip', label: 'Host IP', value: cfg.value.lan?.host_ip },
  { path: 'devbox.ids', label: 'Dev box ids', value: pair(cfg.value.devbox?.ids) },
  { path: 'devbox.ips', label: 'Dev box IPs', value: pair(cfg.value.devbox?.ips) },
  { path: 'marketplace.index', label: 'Marketplace index', value: cfg.value.marketplace?.index },
  { path: 'marketplace.repo', label: 'Marketplace repo', value: cfg.value.marketplace?.repo },
  { path: 'marketplace.counter', label: 'Install counter', value: cfg.value.marketplace?.counter || '' },
  { path: 'marketplace.share_installs', label: 'Share my installs', value: cfg.value.marketplace?.share_installs ? 'on' : 'off' },
])
const cts = computed(() => Object.entries(cfg.value.cts ?? {}) as [string, any][])

const { jobs, run, dismiss } = useActions()
const edit = ref<{ path: string, draft: string } | null>(null)
const pending = ref<{ path: string, value: string, desc: string } | null>(null)
const armed = ref(false)
const cfgErr = ref('')
let armTimer: any
function startEdit(path: string, value: any) { edit.value = { path, draft: String(value ?? '') }; pending.value = null; cfgErr.value = '' }
async function review() {
  if (!edit.value) return
  cfgErr.value = ''
  const args = { path: edit.value.path, value: edit.value.draft }
  try {
    const r = await $fetch<{ desc: string }>('/api/ai/action/check', { method: 'POST', body: { name: 'config_set', args } })
    pending.value = { ...args, desc: r.desc }
    armed.value = false; clearTimeout(armTimer); armTimer = setTimeout(() => (armed.value = true), 1500)
  } catch (e: any) { cfgErr.value = e?.data?.statusMessage || e?.statusMessage || e?.message }
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
  <div class="settings">
    <h2 class="sec">Settings</h2>
    <div v-if="error && !s" class="errbox">{{ error.statusMessage || error.message }}</div>

    <Panel id="connections" title="Connections" :sub="problems ? `${problems} need you` : 'all good'">
      <div v-if="!s" class="faint small">Loading…</div>
      <div v-for="c in rows" :key="c.key || c.id" class="conn">
        <span class="dot" :class="tone(c)" />
        <div class="what">
          <b>{{ c.name }}</b>
          <span class="faint small">{{ c.addon ? c.addon.name : c.used_by }}</span>
        </div>
        <span class="detail small" :class="tone(c) === 'ok' ? 'muted' : tone(c)">{{ c.detail }}</span>
        <div class="fix">
          <button v-if="c.set" type="button" class="btn sm" @click="replacing = replacing === c.set ? '' : c.set; keyDraft = ''">Replace</button>
          <a v-else-if="c.id === 'discord' && !c.addon" class="lnk small" href="#discord">Edit</a>
          <a v-else-if="hasSection(c.addon)" class="lnk small" :href="`#${c.addon.id}`">Open</a>
        </div>
        <div v-if="c.set && replacing === c.set" class="keyedit">
          <input v-model="keyDraft" type="password" autocomplete="off" :placeholder="c.id === 'github' ? 'ghp_… or github_pat_…' : 'tskey-…'">
          <button type="button" class="btn primary sm" :disabled="!keyDraft" @click="saveKey(c.set)">Save</button>
          <div v-if="keyErr" class="errbox small">{{ keyErr }}</div>
        </div>
        <div v-else-if="c.fix && (!c.ok || c.warn) && !hasSection(c.addon)" class="hint faint small">{{ c.fix }}</div>
      </div>
    </Panel>

    <SecretsPanel :list="s?.secrets" @changed="refresh" />

    <Panel id="general" title="General" sub="config.json · changes rebuild the dashboard" fold="phone">
      <div v-if="pending" class="confirm">
        <p class="small">{{ pending.desc }}</p>
        <div class="row">
          <button type="button" class="btn primary sm" :disabled="!armed" @click="apply">Run</button>
          <button type="button" class="btn ghost sm" @click="pending = null">Cancel</button>
        </div>
      </div>
      <JobList :jobs="jobs" @dismiss="dismiss" />
      <div v-for="g in general" :key="g.path" class="kv">
        <span class="k small muted">{{ g.label }}</span>
        <template v-if="edit?.path === g.path">
          <input v-model="edit.draft" class="v">
          <button type="button" class="btn primary sm" @click="review">Review</button>
          <button type="button" class="btn ghost sm" @click="edit = null">Cancel</button>
        </template>
        <template v-else>
          <span class="v mono small">{{ g.value || '—' }}</span>
          <button type="button" class="lnk small" @click="startEdit(g.path, g.value)">Edit</button>
        </template>
      </div>
      <h3 class="small muted cth">Containers</h3>
      <div v-for="[k, c] in cts" :key="k" class="kv">
        <span class="k small muted">{{ k }}</span>
        <template v-if="edit?.path === `cts.${k}.id` || edit?.path === `cts.${k}.ip`">
          <input v-model="edit.draft" class="v">
          <button type="button" class="btn primary sm" @click="review">Review</button>
          <button type="button" class="btn ghost sm" @click="edit = null">Cancel</button>
        </template>
        <template v-else>
          <button type="button" class="lnk small mono" @click="startEdit(`cts.${k}.id`, c.id)">CT {{ c.id }}</button>
          <button type="button" class="lnk small mono" @click="startEdit(`cts.${k}.ip`, c.ip)">{{ c.ip }}</button>
        </template>
      </div>
      <div v-if="cfgErr" class="errbox small">{{ cfgErr }}</div>
    </Panel>

    <div id="discord"><DiscordPanel /></div>

    <template v-for="a in on" :key="a.id">
      <Panel v-if="hasSection(a)" :id="a.id" :title="a.name">
        <SettingsField v-for="f in s?.addons?.[a.id]?.fields ?? []" :key="f.key" :addon="a.id" :f="f" @saved="refresh" />
        <component :is="`Settings${pascal(a.id)}`" v-if="a.settingsUi" />
      </Panel>
    </template>
  </div>
</template>

<style scoped>
.settings :deep(.panel) { margin-bottom: 14px; }
.conn { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 4px 10px; padding: 9px 0; border-top: 1px solid var(--line); }
.conn:first-of-type { border-top: 0; }
.what { display: flex; flex-direction: column; min-width: 0; }
.fix { justify-self: end; }
.keyedit, .hint { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.keyedit input { flex: 1; min-width: 160px; }
.kv { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
.k { width: 130px; flex: none; }
.v { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.cth { margin: 14px 0 4px; font-weight: 500; }
.confirm { border: 1px solid var(--warn); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 10px; }
.confirm p { margin: 0 0 8px; }
.row { display: flex; gap: 8px; }
@media (max-width: 640px) {
  .conn { grid-template-columns: auto minmax(0, 1fr) auto; }
  .detail { grid-column: 2 / -1; grid-row: 2; }
  .k { width: 100%; }
}
@media (pointer: coarse) { .lnk { padding: 6px 4px; } }
</style>
