<script setup lang="ts">
/** every add-on of this dashboard (who built it, what it needs, on/off) and the marketplace of ones not installed yet */
useHead({ title: 'Add-ons · Bastion' })
const { list, off, load, isOn, set } = useAddons()
const { data: o } = useOverview()
const { ctId } = useDashConfig()
onMounted(load)

const { t } = useI18n()
const route = useRoute()
// a switched-off add-on's page lands here as /addons?off=/path (middleware/pages.global.ts): a short message instead of the list
const offPath = computed(() => (typeof route.query.off === 'string' && route.query.off.startsWith('/') ? route.query.off : ''))
// marketplace index (server/utils/marketplace.ts): Update badges here, the not-installed ones below
const { data: market } = useFetch<any>('/api/marketplace', { server: false })
const refreshing = ref(false)
async function refreshMarket(fresh = true) {
  refreshing.value = fresh
  try { market.value = await $fetch<any>('/api/marketplace', { query: fresh ? { fresh: '1' } : {} }) } catch { /* keep what we have */ } finally { refreshing.value = false }
}
// new versions and add-ons show up while the page is open; the agent installs updates by itself every hour
let poll: any
onMounted(() => { poll = setInterval(() => refreshMarket(false), 5 * 60_000) })
onBeforeUnmount(() => clearInterval(poll))
/** 'new' | 'changed': this box's folder differs from the marketplace's, so it can be published */
const publishable = (id: string) => market.value?.local?.[id] as string | undefined
const entry = (id: string) => market.value?.addons?.find((e: any) => e.id === id)
const coreVersion = useRuntimeConfig().public.coreVersion as string
const available = computed(() => (market.value?.addons ?? []).filter((e: any) => !e.installed))
// filters: kind chips (?k=, all = omitted) shared by both tabs, search text per tab
// skins (skin-*) and the Designs add-on itself count as designs; widget packs say kind: widget
const kindOf = (e: any) => (e.kind === 'widget' || e.kind === 'design' ? e.kind : (e.id === 'designs' || String(e.id).startsWith('skin-')) ? 'design' : 'addon')
/** own designs (designs add-on API) mixed into a Designs section carry _d */
const own = (d: any) => ({ ...d, _d: true })
const kind = computed(() => (['addon', 'design', 'widget'].includes(String(route.query.k)) ? String(route.query.k) : 'all'))
function setKind(k: string) { navigateTo({ query: { ...route.query, k: k === 'all' ? undefined : k } }, { replace: true }) }
const hitIn = (q: string, ...f: (string | string[] | undefined)[]) => {
  const n = q.trim().toLowerCase()
  return !n || f.flat().some(x => (x ?? '').toLowerCase().includes(n))
}
const kindChips = (a: number, d: number, w: number) => [
  { key: 'all', label: t('market.all'), n: a + d + w },
  { key: 'addon', label: t('market.addons'), n: a },
  { key: 'design', label: t('market.designs'), n: d },
  { key: 'widget', label: t('market.widgets'), n: w },
]
/** the sections to show: all three in order for All, else just the chosen one; empty ones drop out */
const sectionsOf = (s: { key: string, title: string, items: any[] }[]) => s.filter(x => (kind.value === 'all' || kind.value === x.key) && x.items.length)

// Marketplace
const mq = ref('')
const addonHits = computed(() => available.value.filter((e: any) => hitIn(mq.value, e.name, e.desc, e.author, e.id, e.needs)))
const designHits = computed(() => ((market.value?.designs ?? []) as any[]).filter(d => hitIn(mq.value, d.name, d.author, d.skin)))
const mDesigns = computed(() => [...addonHits.value.filter((e: any) => kindOf(e) === 'design'), ...designHits.value.map(own)])
const mKinds = computed(() => kindChips(addonHits.value.filter((e: any) => kindOf(e) === 'addon').length, mDesigns.value.length, addonHits.value.filter((e: any) => kindOf(e) === 'widget').length))
const mSections = computed(() => sectionsOf([
  { key: 'addon', title: t('market.addons'), items: addonHits.value.filter((e: any) => kindOf(e) === 'addon') },
  { key: 'design', title: t('market.designs'), items: mDesigns.value },
  { key: 'widget', title: t('market.widgets'), items: addonHits.value.filter((e: any) => kindOf(e) === 'widget') },
]))

// Installed: status filter, updates-only, own designs (designs add-on API; failure = section hidden)
const iq = ref('')
const status = ref<'all' | 'on' | 'off'>('all')
const onlyUpd = ref(false)
const mine = ref<any>(null)
watch(() => isOn('designs'), async on => {
  if (!on) { mine.value = null; return }
  try { mine.value = await $fetch<any>('/api/designs') } catch { mine.value = null }
}, { immediate: true })
const myDesigns = computed(() => (isOn('designs') && Array.isArray(mine.value?.mine) ? mine.value.mine : []) as any[])
const iHits = computed(() => list.filter(a => hitIn(iq.value, a.name, a.desc, a.author, a.id, a.needs)
  && (status.value === 'all' || (status.value === 'on') === isOn(a.id))
  && (!onlyUpd.value || entry(a.id)?.update)))
const iDesigns = computed(() => [
  ...iHits.value.filter(a => kindOf(a) === 'design'),
  ...(status.value === 'off' || onlyUpd.value ? [] : myDesigns.value.filter(d => hitIn(iq.value, d.name)).map(own)),
])
const iKinds = computed(() => kindChips(iHits.value.filter(a => kindOf(a) === 'addon').length, iDesigns.value.length, iHits.value.filter(a => kindOf(a) === 'widget').length))
const iSections = computed(() => sectionsOf([
  { key: 'addon', title: t('market.addons'), items: iHits.value.filter(a => kindOf(a) === 'addon') },
  { key: 'design', title: t('market.designs'), items: iDesigns.value },
  { key: 'widget', title: t('market.widgets'), items: iHits.value.filter(a => kindOf(a) === 'widget') },
]))
const iFiltered = computed(() => !!iq.value.trim() || status.value !== 'all' || onlyUpd.value)
const SWATCH = ['bg', 'panel', 'accent', 'text', 'ok']
const count = (n: number | null) => (n == null ? '' : `${n} install${n === 1 ? '' : 's'}`)

// install / update / remove: the agent describes exactly what will happen, Run arms after a moment
// (third-party code, root on pve), then deploy.sh rebuilds the app in its own unit
const { jobs, run, dismiss } = useActions()
const pending = ref<{ name: string, id: string, desc: string } | null>(null)
// install / update: agent/addon_scan.py's safety check of what would land; blocking findings disable Run
// (addon-get checks again and refuses anyway)
const scan = ref<{ state: 'loading' | 'done' | 'error', rep?: any, error?: string } | null>(null)
const blocked = computed(() => scan.value?.state === 'done' && !scan.value.rep.ok)
const shown = computed(() => (scan.value?.rep?.findings ?? []).filter((f: any) => f.level !== 'info'))
const notes = computed(() => (scan.value?.rep?.findings ?? []).filter((f: any) => f.level === 'info'))
async function check(id: string) {
  scan.value = { state: 'loading' }
  try {
    const rep = await $fetch<any>('/api/marketplace/scan', { query: { id }, timeout: 200_000 })
    if (pending.value?.id === id) scan.value = { state: 'done', rep }
  } catch (e: any) {
    if (pending.value?.id === id) scan.value = { state: 'error', error: e?.data?.statusMessage || e?.statusMessage || e?.message }
  }
}
const armed = ref(false)
let armTimer: any
async function ask(name: string, id: string) {
  error.value = ''
  try {
    const r = await $fetch<{ desc: string }>('/api/ai/action/check', { method: 'POST', body: { name, args: { id } } })
    pending.value = { name, id, desc: r.desc }
    scan.value = null
    if (name === 'addon_install' || name === 'addon_update') check(id)
    armed.value = false
    clearTimeout(armTimer)
    armTimer = setTimeout(() => (armed.value = true), 1500)
  } catch (e: any) { error.value = e?.data?.statusMessage || e?.statusMessage || e?.message }
}
function go() {
  const p = pending.value
  if (!p || !armed.value || blocked.value) return
  pending.value = null
  run(p.name, { id: p.id }, p.name === 'addon_publish' ? () => refreshMarket() : undefined)
}
onBeforeUnmount(() => clearTimeout(armTimer))
const rebuilding = computed(() => jobs.value.some(j => j.state === 'done' && j.name.startsWith('addon_') && j.name !== 'addon_publish'))

const busy = ref('')
const error = ref('')
async function toggle(id: string) {
  busy.value = id; error.value = ''
  try { await set(id, !isOn(id)) } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || e?.message
    useToast().toast(`Not changed: ${error.value}`, { tone: 'bad' })
  } finally { busy.value = '' }
}
const ctState = (key?: string) => {
  const id = key && ctId(key)
  const c = id && o.value?.cts?.find((x: any) => x.vmid === id)
  return c ? { text: `CT ${id} ${c.status}`, tone: c.status === 'running' ? 'ok' : 'warn' } : null
}
// sections as top tabs; old #anchors (#marketplace, #core) still land on theirs
const tab = usePageTab('installed')
const updates = computed(() => list.filter(a => entry(a.id)?.update).length)
const tabs = computed(() => [
  { key: 'installed', label: `${t('tabs.installed')} ${list.length - (off.value?.length ?? 0)}/${list.length}`, icon: 'grid', badge: updates.value || undefined, tone: 'warn' as const },
  { key: 'market', label: t('tabs.marketplace'), icon: 'download' },
  { key: 'core', label: t('tabs.core'), icon: 'layers' },
])
const HASH: Record<string, string> = { installed: 'installed', marketplace: 'market', market: 'market', core: 'core' }
function follow(hash: string) {
  const key = HASH[hash.slice(1)]
  if (key) navigateTo({ query: { ...route.query, s: key === 'installed' ? undefined : key }, hash: '' }, { replace: true })
}
watch(() => route.hash, h => h && follow(h), { immediate: true })
const names = (ids?: string[]) => (ids ?? []).map(i => list.find(a => a.id === i)?.name ?? i).join(', ')
</script>

<template>
  <div>
    <div v-if="offPath" class="empty-state">
      <p>{{ $t('addons.pageOff', { page: offPath }) }}</p>
      <NuxtLink to="/addons" class="btn sm">{{ $t('addons.backToAddons') }}</NuxtLink>
    </div>
    <template v-else>
    <div v-if="error" class="errbox">{{ error }}</div>
    <div v-if="pending" class="card confirm">
      <p class="small">{{ pending.desc }}</p>
      <div v-if="scan" class="scan small">
        <div v-if="scan.state === 'loading'" class="faint">Safety check: fetching and reading the code…</div>
        <div v-else-if="scan.state === 'error'" class="warn">Safety check failed: {{ scan.error }} (it runs again on Run)</div>
        <template v-else>
          <div>
            <span class="pill" :class="scan.rep.ok ? (scan.rep.count.warn ? 'warn' : 'ok') : 'bad'">
              {{ scan.rep.ok ? (scan.rep.count.warn ? `${scan.rep.count.warn} warning${scan.rep.count.warn === 1 ? '' : 's'}` : 'Safety check passed') : `Blocked: ${scan.rep.count.block} finding${scan.rep.count.block === 1 ? '' : 's'}` }}
            </span>
            <span class="faint"> ClamAV {{ scan.rep.clamav }}</span>
          </div>
          <div v-if="scan.rep.core_block" class="bad">{{ scan.rep.core_block }}</div>
          <ul v-if="shown.length" class="finds">
            <li v-for="(f, i) in shown" :key="i">
              <b :class="f.level === 'block' ? 'bad' : 'warn'">{{ f.rule }}</b> <span class="mono">{{ f.file }}{{ f.line ? `:${f.line}` : '' }}</span> {{ f.why }}
              <div v-if="f.text" class="mono faint snip">{{ f.text }}</div>
            </li>
          </ul>
          <div v-if="notes.length" class="faint">Also: {{ [...new Set(notes.map((f: any) => f.why))].join('; ') }}</div>
          <div v-if="scan.rep.domains?.length" class="faint">Talks to: {{ scan.rep.domains.join(', ') }}</div>
          <div v-if="scan.rep.changed?.length" class="faint">{{ scan.rep.changed.length }} file{{ scan.rep.changed.length === 1 ? '' : 's' }} changed: <span class="mono">{{ scan.rep.changed.slice(0, 12).join(', ') }}{{ scan.rep.changed.length > 12 ? ' …' : '' }}</span></div>
        </template>
      </div>
      <div class="row">
        <button type="button" class="btn primary sm" :disabled="!armed || blocked" @click="go">Run</button>
        <button type="button" class="btn ghost sm" @click="pending = null">Cancel</button>
      </div>
    </div>
    <JobList :jobs="jobs" @dismiss="dismiss" />
    <div v-if="rebuilding" class="small warn">Rebuilding: the dashboard is back in a few minutes; reload then.</div>
    <PageTabs v-model="tab" :tabs="tabs" />
    <template v-if="tab === 'installed'">
    <AddonFilters v-model:q="iq" :kinds="iKinds" :kind="kind" @kind="setKind">
      <div class="seg">
        <button type="button" :class="{ on: status === 'all' }" @click="status = 'all'">{{ $t('market.statusAll') }}</button>
        <button type="button" :class="{ on: status === 'on' }" @click="status = 'on'">{{ $t('market.statusOn') }}</button>
        <button type="button" :class="{ on: status === 'off' }" @click="status = 'off'">{{ $t('market.statusOff') }}</button>
      </div>
      <button v-if="updates" type="button" class="chip" :class="{ on: onlyUpd }" @click="onlyUpd = !onlyUpd">{{ $t('market.updates') }} {{ updates }}</button>
    </AddonFilters>
    <div v-if="!iSections.length" class="empty-state">{{ iFiltered ? $t('market.noMatch') : $t('market.nothing') }}</div>
    <section v-for="sec in iSections" :key="sec.key" class="kindsec">
      <h2 class="sec mk">
        <span>{{ sec.title }} <span class="faint small">{{ sec.items.length }}</span></span>
        <NuxtLink v-if="sec.key === 'widget' && isOn('widgets')" to="/widgets" class="lnk small">{{ $t('market.openWidgets') }}</NuxtLink>
      </h2>
      <div class="grid cols-2 list">
          <div v-for="a in sec.items.filter((x: any) => !x._d)" :key="a.id" class="card" :class="{ dim: !isOn(a.id) }">
            <div class="top">
              <Icon :name="a.icon" :size="18" class="i" />
              <div class="who">
                <b>{{ a.name }}</b>
                <span class="faint small">by {{ a.author }}</span>
              </div>
              <button type="button" class="btn sm" :class="isOn(a.id) ? 'ghost' : 'primary'" :disabled="busy === a.id || off === null" @click="toggle(a.id)">
                {{ isOn(a.id) ? 'Turn off' : 'Turn on' }}
              </button>
            </div>
            <p class="small muted desc">{{ a.desc }}</p>
            <div class="tags">
              <span v-if="kindOf(a) === 'widget'" class="pill accent">{{ $t('market.widgetPill') }}</span>
              <span v-if="a.version" class="pill">v{{ a.version }}</span>
              <span v-if="a.license" class="pill">{{ a.license }}</span>
              <span v-if="a.warning" class="pill warn" :title="a.warning">terms risk</span>
              <button v-if="entry(a.id)?.update" type="button" class="pill accent lnk-pill" @click="ask('addon_update', a.id)">update to v{{ entry(a.id).version }}</button>
              <span v-if="count(entry(a.id)?.installs ?? null)" class="pill">{{ count(entry(a.id).installs) }}</span>
              <span v-if="ctState(a.ct)" class="pill" :class="ctState(a.ct)!.tone">{{ ctState(a.ct)!.text }}</span>
              <span v-for="n in a.needs" :key="n" class="pill">{{ n }}</span>
              <span v-if="a.dependsOn" class="pill accent">needs {{ names(a.dependsOn) }}</span>
              <button v-if="publishable(a.id)" type="button" class="pill accent lnk-pill" @click="ask('addon_publish', a.id)">
                {{ publishable(a.id) === 'new' ? 'Publish' : 'Publish changes' }}
              </button>
              <button v-if="a.version" type="button" class="btn ghost sm rm" @click="ask('addon_remove', a.id)">Remove</button>
            </div>
          </div>
          <div v-for="d in sec.items.filter((x: any) => x._d)" :key="`d:${d.id}`" class="card">
            <div class="top">
              <div class="who"><b>{{ d.name }}</b></div>
              <NuxtLink to="/designs" class="btn sm">{{ $t('market.openOne') }}</NuxtLink>
            </div>
            <div class="swatches">
              <i v-for="k in SWATCH" :key="k" class="sw" :style="{ background: d.tokens?.[k] }" />
            </div>
            <div class="tags">
              <span class="pill">{{ $t('market.designPill') }}</span>
              <span v-if="mine?.pick === `d:${d.id}`" class="pill ok">{{ $t('market.inUse') }}</span>
            </div>
          </div>
      </div>
      <p v-if="sec.key === 'addon'" class="faint small">Always on: Home, Notes, Chat, Metrics. Turning an add-on off hides it here; its container keeps running.</p>
    </section>

    </template>

    <CorePanel v-else-if="tab === 'core'" />

    <template v-else>
    <h2 class="sec mk">
      <span>Marketplace <span v-if="market?.source === 'local'" class="faint small">offline copy</span></span>
      <button type="button" class="btn ghost sm" :disabled="refreshing" @click="refreshMarket()">{{ refreshing ? 'Checking…' : 'Refresh' }}</button>
    </h2>
    <AddonFilters v-model:q="mq" :kinds="mKinds" :kind="kind" @kind="setKind" />
    <Skeleton v-if="!market" kind="rows" :n="4" />
    <div v-else-if="!mSections.length" class="empty-state">{{ mq.trim() ? $t('market.noMatch') : $t('market.nothing') }}</div>
    <template v-else>
    <section v-for="sec in mSections" :key="sec.key" class="kindsec">
      <h2 class="sec mk"><span>{{ sec.title }} <span class="faint small">{{ sec.items.length }}</span></span></h2>
      <div class="grid cols-2 list">
          <div v-for="e in sec.items.filter((x: any) => !x._d)" :key="e.id" class="card">
            <div class="top">
              <Icon :name="e.icon || 'grid'" :size="18" class="i" />
              <div class="who">
                <b>{{ e.name }}</b>
                <span class="faint small">by {{ e.author }}</span>
              </div>
              <button type="button" class="btn primary sm" @click="ask('addon_install', e.id)">Install</button>
            </div>
            <p class="small muted desc">{{ e.desc }}</p>
            <p v-if="e.warning" class="small warn desc"><Icon name="triangle-alert" :size="14"/> {{ e.warning }}</p>
            <div class="tags">
              <span v-if="kindOf(e) === 'widget'" class="pill accent">{{ $t('market.widgetPill') }}</span>
              <span class="pill">v{{ e.version }}</span>
              <span v-if="e.license" class="pill">{{ e.license }}</span>
              <span v-if="count(e.installs)" class="pill">{{ count(e.installs) }}</span>
              <span v-for="n in e.needs" :key="n" class="pill">{{ n }}</span>
              <span v-if="e.depends_on?.length" class="pill accent">needs {{ names(e.depends_on) }}</span>
              <span v-if="!coreSatisfies(coreVersion, e.core)" class="pill bad">needs core {{ e.core }}</span>
            </div>
          </div>
          <div v-for="d in sec.items.filter((x: any) => x._d)" :key="`d:${d.slug}`" class="card">
            <div class="top">
              <div class="who">
                <b>{{ d.name }}</b>
                <span class="faint small">{{ $t('market.by', { name: d.author }) }}</span>
              </div>
              <NuxtLink v-if="isOn('designs')" to="/designs?s=market" class="btn sm">{{ $t('market.openDesigns') }}</NuxtLink>
            </div>
            <div class="swatches">
              <i v-for="k in SWATCH" :key="k" class="sw" :style="{ background: d.tokens?.[k] }" />
            </div>
            <div class="tags">
              <span class="pill">{{ $t('market.designPill') }}</span>
              <span v-if="d.skin" class="pill">{{ d.skin }}</span>
            </div>
            <p v-if="!isOn('designs')" class="small faint desc">{{ $t('market.needDesigns') }}</p>
          </div>
      </div>
    </section>
    </template>
    </template>
    </template>
  </div>
</template>

<style scoped>
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.card.dim { opacity: .55; }
.top { display: flex; align-items: center; gap: 10px; }
.top .i { color: var(--accent); flex: none; }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.desc { margin: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.tags .rm { margin-left: auto; }
.kindsec { margin-bottom: 14px; }
.swatches { display: flex; gap: 4px; }
.sw { width: 22px; height: 22px; border-radius: var(--radius-sm); border: 1px solid var(--line-2); }
.mk { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lnk-pill { cursor: pointer; font: inherit; font-size: 11.5px; }
.confirm { border-color: var(--warn); margin-bottom: 14px; }
.confirm p { margin: 0; }
.row { display: flex; gap: 8px; }
.scan { display: flex; flex-direction: column; gap: 6px; }
.finds { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.snip { overflow-wrap: anywhere; font-size: 11px; }
@media (pointer: coarse) { .lnk-pill { padding: 6px 10px; } }
/* phone: compact rows, the description cut to two lines */
@media (max-width: 640px) { .desc { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } }
</style>
