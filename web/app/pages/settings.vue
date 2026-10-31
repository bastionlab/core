<script setup lang="ts">
/**
 * One place for everything that's configured, sorted into a few categories (<PageTabs>, ?s=<cat> in the URL): You (account, language, alerts), Access (users, secrets), Connections (every outside
 * link, the core's and each add-on's, + Discord), System (config.json, backup, deploy) and Add-ons (a section per
 * add-on from its addon.yaml `settings:` + its own Settings<Id>.global.vue). Old #anchors still land in the right one.
 */
const { t } = useI18n()
useHead({ title: () => `${t('nav.settings')} · Bastion` })
const route = useRoute()
const { data: s, refresh, error } = useFetch<any>('/api/settings', { server: false })
const { list, pageOn, load, role } = useAddons()
// everything but your own account and language is the owner's (shared/utils/roles.ts)
const owner = computed(() => !role.value || role.value === 'owner')
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
// broken ones first, so the list reads as a to-do
const sorted = computed(() => [...rows.value].sort((a, b) => ({ bad: 0, warn: 1, ok: 2 } as any)[tone(a)] - ({ bad: 0, warn: 1, ok: 2 } as any)[tone(b)]))
const bad = computed(() => rows.value.filter(c => !c.ok || c.warn))
const good = computed(() => rows.value.filter(c => c.ok && !c.warn))
const problems = computed(() => rows.value.filter(c => !c.ok || c.warn).length)
const oldSecrets = computed(() => (s.value?.secrets ?? []).filter((r: any) => !r.set || r.old).length)
/** where the owner fixes a connection: an inline key field, a section on this page, or a hint */
const hasSection = (a: any) => a && (a.settingsUi || s.value?.addons?.[a.id])
const addonSections = computed(() => on.value.filter(hasSection))

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

// --- categories ------------------------------------------------------------------------------------------------
type Cat = 'you' | 'access' | 'connections' | 'system' | 'addons'
const cats = computed(() => {
  const all: { key: Cat, icon: string, badge?: number, tone?: 'warn' }[] = [
    { key: 'you', icon: 'shield' },
    { key: 'access', icon: 'key', badge: oldSecrets.value, tone: 'warn' },
    { key: 'connections', icon: 'send', badge: problems.value, tone: 'warn' },
    { key: 'system', icon: 'settings' },
    { key: 'addons', icon: 'grid' },
  ]
  return owner.value ? all : all.slice(0, 1)
})
const tab = usePageTab('you')
const cat = computed<Cat>(() => (cats.value.some(c => c.key === tab.value) ? tab.value as Cat : 'you'))
const tabs = computed(() => cats.value.map(c => ({ key: c.key, label: t(`settings.cat.${c.key}`), icon: c.icon, badge: c.badge || undefined, tone: c.badge ? c.tone : undefined })))

// panel anchors (old links like /settings#money) → their category
const ANCHOR: Record<string, Cat> = { account: 'you', language: 'you', notifications: 'you', users: 'access', secrets: 'access', connections: 'connections', discord: 'connections', general: 'system', backup: 'system', deploy: 'system' }
const catOf = (anchor: string): Cat => ANCHOR[anchor] ?? 'addons'
async function go(c: Cat, anchor = '') {
  q.value = ''
  await navigateTo({ query: { ...route.query, s: c === 'you' ? undefined : c }, hash: anchor ? `#${anchor}` : '' })
  await nextTick()
  if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
onMounted(() => { const h = route.hash.slice(1); if (h && !route.query.s) go(catOf(h), h) })

// --- search: every panel, config field, connection and add-on field, one jump away ---------------------------
const q = ref('')
const index = computed(() => {
  const e: { label: string, sub?: string, cat: Cat, anchor: string }[] = [
    { label: t('auth.acct'), cat: 'you', anchor: 'account' },
    { label: t('prefs.title'), cat: 'you', anchor: 'language' },
    { label: t('settings.notifications'), sub: t('settings.notifications_k'), cat: 'you', anchor: 'notifications' },
  ]
  if (!owner.value) return e
  e.push(
    { label: t('users.title'), sub: 'invite roles', cat: 'access', anchor: 'users' },
    { label: t('settings.secrets'), sub: t('settings.secrets_k'), cat: 'access', anchor: 'secrets' },
    { label: t('settings.conn.title'), cat: 'connections', anchor: 'connections' },
    { label: t('settings.discord'), sub: t('settings.discord_k'), cat: 'connections', anchor: 'discord' },
    { label: t('settings.gen.title'), sub: 'config.json', cat: 'system', anchor: 'general' },
    { label: t('backup.title'), cat: 'system', anchor: 'backup' },
    { label: t('deploy.title'), sub: 'github release', cat: 'system', anchor: 'deploy' },
    ...['name', 'tailnet', 'logins', 'subnet', 'hostip', 'dbids', 'dbips', 'index', 'repo', 'counter', 'share', 'auto', 'cts']
      .map(k => ({ label: t(`settings.gen.${k}`), sub: t(`settings.gen.${k}_h`), cat: 'system' as Cat, anchor: 'general' })),
    ...rows.value.map((c: any) => ({ label: c.name, sub: c.addon?.name ?? c.used_by, cat: 'connections' as Cat, anchor: 'connections' })),
    ...addonSections.value.flatMap(a => [
      { label: a.name, cat: 'addons' as Cat, anchor: a.id },
      ...(s.value?.addons?.[a.id]?.fields ?? []).map((f: any) => ({ label: f.label, sub: a.name, cat: 'addons' as Cat, anchor: a.id })),
    ]),
  )
  return e
})
const hits = computed(() => {
  const n = q.value.trim().toLowerCase()
  if (!n) return []
  const seen = new Set<string>()
  return index.value.filter(e => `${e.label} ${e.sub ?? ''}`.toLowerCase().includes(n))
    .filter(e => { const k = `${e.label}|${e.anchor}`; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 12)
})
</script>

<template>
  <div class="settings">
    <header class="top">
      <h1>{{ t('settings.title') }}</h1>
      <div v-if="cats.length > 1" class="find">
        <Icon name="search" :size="15" class="faint" />
        <input v-model="q" type="search" :placeholder="t('settings.search')">
        <div v-if="q.trim()" class="hits">
          <button v-for="h in hits" :key="`${h.label}|${h.anchor}`" type="button" class="hit" @click="go(h.cat, h.anchor)">
            <span>{{ h.label }}</span>
            <span class="faint small">{{ t(`settings.cat.${h.cat}`) }}{{ h.sub ? ` · ${h.sub}` : '' }}</span>
          </button>
          <p v-if="!hits.length" class="faint small pad">{{ t('settings.noHits', { q: q.trim() }) }}</p>
        </div>
      </div>
    </header>
    <div v-if="error && !s && owner" class="errbox">{{ error.statusMessage || error.message }}</div>
    <PageTabs v-if="cats.length > 1" v-model="tab" :tabs="tabs" />
    <p v-if="cats.length > 1" class="faint small lead">{{ t(`settings.cat.${cat}_d`) }}</p>

    <div class="content">
        <template v-if="cat === 'you'">
          <AccountPanel />
          <LocalePanel />
          <NotificationsPanel v-if="owner" />
        </template>

        <template v-else-if="cat === 'access'">
          <UsersPanel />
          <SecretsPanel :list="s?.secrets" @changed="refresh" />
        </template>

        <template v-else-if="cat === 'connections'">
          <Panel id="connections" :title="t('settings.conn.title')" :sub="problems ? t('settings.needs', { n: problems }) : t('settings.allGood')">
            <Skeleton v-if="!s" kind="rows" :n="5" />
            <p v-else-if="!rows.length" class="faint small">{{ t('settings.conn.none') }}</p>
            <template v-for="g in [{ k: 'attention', list: bad }, { k: 'working', list: good }]" :key="g.k">
              <div v-if="g.list.length" class="group">
                <h3 class="grp">{{ t(`settings.${g.k}`) }}<span class="faint"> {{ g.list.length }}</span></h3>
                <div v-for="c in g.list" :key="c.key || c.id" class="conn">
                  <span class="dot" :class="tone(c)" />
                  <div class="what">
                    <b>{{ c.name }}</b>
                    <span class="faint small">{{ c.addon ? c.addon.name : c.used_by }}</span>
                  </div>
                  <span class="detail small" :class="tone(c) === 'ok' ? 'muted' : tone(c)">{{ c.detail }}</span>
                  <div class="fix">
                    <button v-if="c.set" type="button" class="btn sm" @click="replacing = replacing === c.set ? '' : c.set; keyDraft = ''">{{ t('settings.replace') }}</button>
                    <a v-else-if="c.id === 'discord' && !c.addon" class="lnk small" href="#discord" @click.prevent="go('connections', 'discord')">{{ t('settings.edit') }}</a>
                    <button v-else-if="hasSection(c.addon)" type="button" class="lnk small" @click="go('addons', c.addon.id)">{{ t('settings.open') }}</button>
                  </div>
                  <div v-if="c.set && replacing === c.set" class="keyedit">
                    <input v-model="keyDraft" type="password" autocomplete="off" :placeholder="c.id === 'github' ? 'ghp_… or github_pat_…' : 'tskey-…'">
                    <button type="button" class="btn primary sm" :disabled="!keyDraft" @click="saveKey(c.set)">{{ t('common.save') }}</button>
                    <div v-if="keyErr" class="errbox small">{{ keyErr }}</div>
                  </div>
                  <div v-else-if="c.fix && (!c.ok || c.warn) && !hasSection(c.addon)" class="hint faint small">{{ c.fix }}</div>
                </div>
              </div>
            </template>
          </Panel>
          <div id="discord"><DiscordPanel /></div>
        </template>

        <template v-else-if="cat === 'system'">
          <InstallPanel :cfg="s?.config" />
          <BackupPanel />
          <DeployPanel />
        </template>

        <template v-else-if="cat === 'addons'">
          <div v-if="addonSections.length > 1" class="jump">
            <button v-for="a in addonSections" :key="a.id" type="button" class="chip" @click="go('addons', a.id)">{{ a.name }}</button>
          </div>
          <p v-if="s && !addonSections.length" class="empty-state">{{ t('common.nothing') }}</p>
          <Panel v-for="a in addonSections" :id="a.id" :key="a.id" :title="a.name">
            <SettingsField v-for="f in s?.addons?.[a.id]?.fields ?? []" :key="f.key" :addon="a.id" :f="f" @saved="refresh" />
            <component :is="`Settings${pascal(a.id)}`" v-if="a.settingsUi" />
          </Panel>
        </template>
    </div>
  </div>
</template>

<style scoped>
.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.top h1 { font-size: 20px; font-weight: 600; margin: 0; }
.grp { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 14px 0 2px; }
.group:first-child .grp { margin-top: 0; }
.find { position: relative; flex-shrink: 1; display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 0 10px; flex: 0 1 280px; min-width: 0; }
.find:focus-within { border-color: var(--accent); }
.find input { flex: 1; border: 0; background: none; padding: 7px 0; min-width: 0; border-radius: 0; box-shadow: none; outline: none; -webkit-appearance: none; appearance: none; }
.hits { position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; right: 0; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line-2); border-radius: var(--radius-sm); padding: 4px; box-shadow: 0 8px 24px rgb(0 0 0 / .3); max-height: 60vh; overflow-y: auto; }
.hit { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border-radius: var(--radius-sm); }
.hit:hover { background: var(--panel-2); }
.pad { padding: 8px 10px; margin: 0; }
.lead { margin: -6px 0 12px; }
.content { min-width: 0; }
.content :deep(.panel) { margin-bottom: 14px; }
.jump { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }

.conn { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 4px 10px; padding: 9px 0; border-top: 1px solid var(--line); }
.grp + .conn { border-top: 0; }
.what { display: flex; flex-direction: column; min-width: 0; }
.fix { justify-self: end; }
.keyedit, .hint { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.keyedit input { flex: 1; min-width: 160px; }

@media (max-width: 640px) {
  .top h1 { display: none; }
  .find { flex-basis: 100%; }
  .conn { grid-template-columns: auto minmax(0, 1fr) auto; }
  .detail { grid-column: 2 / -1; grid-row: 2; }
}
@media (pointer: coarse) { .lnk { padding: 6px 4px; } }
</style>
