<script setup lang="ts">
useHead({ title: 'Bastion' })
const { data: o, error, refresh } = useOverview()

const list = computed(() => alerts(o.value))
const apps = computed(() => (o.value?.services ?? []).filter((s: any) => s.group === 'app'))
const down = computed(() => apps.value.filter((s: any) => !s.up).length)

const running = computed(() => (o.value?.cts ?? []).filter((c: any) => c.status === 'running').length)
const updates = computed(() => (o.value?.updates?.host?.count ?? 0)
  + Object.values(o.value?.updates?.cts ?? {}).reduce((s: number, u: any) => s + (u?.count ?? 0), 0))

/** the glance band — the house in a handful of numbers */
const band = computed(() => [
  { label: 'CPU', value: o.value ? `${Math.round(o.value.host.cpu ?? 0)}%` : '–', tone: (o.value?.host?.cpu ?? 0) > 85 ? 'warn' : '' },
  { label: 'RAM', value: o.value ? `${pct(o.value.host.mem.used, o.value.host.mem.total).toFixed(0)}%` : '–' },
  { label: 'GPU', value: o.value?.gpu ? `${o.value.gpu.util ?? 0}%` : '–' },
  { label: 'Containers', value: o.value ? `${running.value}/${o.value.cts.length}` : '–', tone: o.value && running.value < o.value.cts.length ? 'warn' : '' },
  { label: 'Updates', value: o.value ? updates.value : '–', tone: updates.value ? 'warn' : '' },
  { label: 'Uptime', value: o.value ? duration(o.value.host.uptime) : '–' },
])
const health = computed(() => {
  if (!o.value) return { tone: '', text: 'Loading…' }
  const bad = list.value.filter(a => a.level === 'bad').length
  if (bad) return { tone: 'bad', text: `${bad} problem${bad > 1 ? 's' : ''}` }
  if (list.value.length) return { tone: 'warn', text: `${list.value.length} to check` }
  return { tone: 'ok', text: 'All good' }
})

// Sections: one card per add-on that brings one (addon.yaml `home: true` → its Home<Id>.global.vue), in tab
// order; Metrics is core. Chat sits last like in the nav.
const { list: addons, pageOn } = useAddons()
const pascal = (id: string) => id.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join('')
const cards = computed(() => addons.filter(a => a.home && a.routes[0] && pageOn(a.routes[0])).map(a => ({ id: a.id, order: a.order ?? 100, comp: `Home${pascal(a.id)}` })))
// the viewer's layout (Edit): order, hidden and pinned apps/cards, shared by every device (useSynced)
// sizes: grid cells per item (columns × rows); 2×1 isn't stored. Older layouts kept 's' / 'l' there.
interface Box { w: number, h: number }
interface HomeLayout { apps: string[], cards: string[], pinned: string[], hidden: string[], sizes: Record<string, Box | 's' | 'l'> }
const EMPTY: HomeLayout = { apps: [], cards: [], pinned: [], hidden: [], sizes: {} }
const pref = useSynced<HomeLayout>('home', () => ({ ...EMPTY }))
const draft = ref<HomeLayout | null>(null) // while a drag is under way
const lay = computed<HomeLayout>(() => ({ ...EMPTY, ...(draft.value ?? pref.value.value ?? {}) }))
const editing = ref(false)
// the tile whose frame is showing in edit mode (its key)
const selected = ref('')
watch(editing, () => { selected.value = '' })
// the Ask bar needs admin, the Home layout is the owner's (shared/utils/roles.ts)
const { role } = useAddons()
const canRole = (need: 'viewer' | 'member' | 'admin' | 'owner') => !role.value || atLeast(role.value, need)
const save = (l: HomeLayout) => { draft.value = null; pref.set(l) }

interface Item { id: string, key: string, s?: any, comp?: string }
const sortBy = (items: Item[], order: string[]) => [...items].sort((a, b) => {
  const i = order.indexOf(a.id), j = order.indexOf(b.id)
  return (i < 0 ? 1e6 + items.indexOf(a) : i) - (j < 0 ? 1e6 + items.indexOf(b) : j)
})
const appItems = computed<Item[]>(() => apps.value.map((s: any) => ({ id: s.name, key: `app:${s.name}`, s })))
const cardItems = computed<Item[]>(() => [
  ...cards.value.filter(c => c.order < 90).map(c => ({ id: c.id, key: `card:${c.id}`, comp: c.comp })),
  { id: 'metrics', key: 'card:metrics' },
  { id: 'power', key: 'card:power', comp: 'HomePower' },
  ...cards.value.filter(c => c.order >= 90).map(c => ({ id: c.id, key: `card:${c.id}`, comp: c.comp })),
])
const shown = (it: Item) => editing.value || !lay.value.hidden.includes(it.key)
const pinnedOf = (items: Item[]) => lay.value.pinned.map(k => items.find(i => i.key === k)).filter((i): i is Item => !!i && shown(i))
const groups = computed<Record<string, Item[]>>(() => ({
  apps: sortBy(appItems.value.filter(i => !lay.value.pinned.includes(i.key)), lay.value.apps).filter(shown),
  cards: sortBy(cardItems.value.filter(i => !lay.value.pinned.includes(i.key)), lay.value.cards).filter(shown),
  papps: pinnedOf(appItems.value),
  pcards: pinnedOf(cardItems.value),
}))
const { grab, dragging } = useSortable(
  g => groups.value[g]!.map(i => i.id),
  (g, ids) => {
    const l = { ...lay.value }
    if (g === 'apps' || g === 'cards') l[g] = ids
    else {
      const pre = g === 'papps' ? 'app:' : 'card:'
      const other = l.pinned.filter(k => !k.startsWith(pre))
      l.pinned = g === 'papps' ? [...ids.map(i => pre + i), ...other] : [...other, ...ids.map(i => pre + i)]
    }
    draft.value = l
  },
  () => { if (draft.value) save(draft.value) },
)
const toggle = (field: 'pinned' | 'hidden', key: string) => {
  const l = { ...lay.value }
  l[field] = l[field].includes(key) ? l[field].filter(k => k !== key) : [...l[field], key]
  save(l)
}
const isHidden = (it: Item) => lay.value.hidden.includes(it.key)
const isPinned = (it: Item) => lay.value.pinned.includes(it.key)
const custom = computed(() => Object.values(lay.value).some(v => (Array.isArray(v) ? v.length : Object.keys(v).length)))
const BOX: Box = { w: 2, h: 1 }
const boxOf = (key: string): Box => {
  const v = lay.value.sizes[key]
  return v === 's' ? { w: 1, h: 1 } : v === 'l' ? { w: 4, h: 2 } : v ?? BOX
}
// the corner handle reports every step; the draft shows it, release saves
function resize(key: string, b: Box) {
  const sizes = { ...lay.value.sizes }
  if (b.w === BOX.w && b.h === BOX.h) delete sizes[key]
  else sizes[key] = b
  draft.value = { ...lay.value, sizes }
}
const { armed, arm } = useArm()
const reset = () => { if (arm('reset')) save({ ...EMPTY }) }
const bind = (it: Item, group: string) => ({
  it, editing: editing.value, hidden: isHidden(it), pinned: isPinned(it), drag: dragging.value === `${group}:${it.id}`,
  'data-sort': `${group}:${it.id}`, selected: selected.value === it.key, chips: metricsChips.value, more: metricsMore.value, box: boxOf(it.key),
  onGrab: (e: PointerEvent, el: HTMLElement) => { selected.value = it.key; grab(e, group, it.id, el) },
  onSelect: () => { selected.value = selected.value === it.key ? '' : it.key }, onPin: () => toggle('pinned', it.key), onHide: () => toggle('hidden', it.key),
  onResize: (b: Box) => resize(it.key, b), onResized: () => { if (draft.value) save(draft.value) },
})

// the Metrics card when it's large
const metricsMore = computed(() => o.value
  ? [
      ...band.value.slice(0, 3).map(b => ({ text: b.label, sub: String(b.value), tone: b.tone })),
      ...list.value.slice(0, 3).map(a => ({ text: a.text, tone: a.level })),
    ]
  : [])
const metricsChips = computed(() => o.value
  ? [
      ...(list.value.length ? [{ text: `${list.value.length} alerts`, tone: list.value.some(a => a.level === 'bad') ? 'bad' : 'warn' }] : []),
      ...(updates.value ? [{ text: `${updates.value} updates`, tone: 'warn' }] : [{ text: 'up to date' }]),
    ]
  : [])
</script>

<template>
  <div>
    <AskPanel
      scope="home" placeholder="Ask anything about the house server…"
      :examples="['Is everything working?', 'What is new on Jellyfin?', 'Anything I should fix?', 'What is the weather today?']"
      @refresh="refresh"
    />

    <div v-if="error && !o" class="bad pad">Could not reach the agent: {{ error.statusMessage || error.message }}</div>

    <template v-if="groups.papps.length || groups.pcards.length">
      <h2 class="sec">Pinned</h2>
      <div v-if="groups.papps.length" class="apps">
        <HomeItem v-for="it in groups.papps" :key="it.key" v-bind="bind(it, 'papps')" />
      </div>
      <div v-if="groups.pcards.length" class="topics" :class="{ gap: groups.papps.length }">
        <HomeItem v-for="it in groups.pcards" :key="it.key" v-bind="bind(it, 'pcards')" />
      </div>
      <div class="pin-end" />
    </template>

    <Skeleton v-if="!o && !error" kind="band" :n="7" class="band-sk" />
    <div v-else class="band">
      <div class="cell health" :class="health.tone">
        <span class="dot" :class="health.tone" />
        <b>{{ health.text }}</b>
      </div>
      <div v-for="b in band" :key="b.label" class="cell">
        <span class="lbl">{{ b.label }}</span>
        <b :class="b.tone">{{ b.value }}</b>
      </div>
    </div>
    <AlertsBar :items="list" />

    <h2 class="sec">
      Apps <span v-if="down" class="bad small">{{ down }} down</span>
      <span class="edit-row">
        <button v-if="editing && custom" type="button" class="btn sm" :class="{ sure: armed === 'reset' }" @click="reset">{{ armed === 'reset' ? 'Sure?' : 'Reset layout' }}</button>
        <button v-if="canRole('owner')" type="button" class="btn sm" :class="editing ? 'primary' : 'ghost'" @click="editing = !editing">{{ editing ? 'Done' : 'Edit' }}</button>
      </span>
    </h2>
    <p v-if="editing" class="small faint hint">{{ $t('home.editHint') }}</p>
    <Skeleton v-if="!o && !error" kind="tiles" :n="6" />
    <div v-else-if="groups.apps.length" class="apps">
      <HomeItem v-for="it in groups.apps" :key="it.key" v-bind="bind(it, 'apps')" />
    </div>

    <h2 class="sec">Sections</h2>
    <div class="topics">
      <HomeItem v-for="it in groups.cards" :key="it.key" v-bind="bind(it, 'cards')" />
    </div>
  </div>
</template>

<style scoped>
.pad { padding: 60px 0; text-align: center; }

.band {
  display: grid; grid-template-columns: 1.4fr repeat(6, minmax(0, 1fr)); gap: 0;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); margin-bottom: 14px; overflow: hidden;
}
.cell { display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; padding: 14px 16px; }
.cell + .cell { border-left: 1px solid var(--line); }
.lbl { font-size: 12px; color: var(--faint); }
.cell b { font-size: 18px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.health { flex-direction: row; align-items: center; justify-content: flex-start; gap: 12px; }
.health.ok { background: linear-gradient(90deg, var(--ok-soft), transparent); }
.health.warn { background: linear-gradient(90deg, var(--warn-soft), transparent); }
.health.bad { background: linear-gradient(90deg, var(--bad-soft), transparent); }
.health b { font-size: 16px; }

/* a grid of cells: every item spans its own columns × rows (HomeItem) and its content fits itself to that */
.apps, .topics { --row: 72px; grid-auto-rows: var(--row); }
.topics { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); grid-auto-flow: row dense; gap: 10px; }
@media (max-width: 1250px) { .apps { grid-template-columns: repeat(8, minmax(0, 1fr)); } .topics { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@media (max-width: 900px) { .apps, .topics { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.topics.gap { margin-top: 10px; }
.apps { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); grid-auto-flow: row dense; gap: 10px; }
.band-sk { margin-bottom: 14px; }
.pin-end { height: 14px; }
.hint { margin: -4px 0 10px; }
.edit-row { margin-left: auto; display: flex; gap: 6px; align-self: center; }



@media (max-width: 1100px) {
  .band { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .health { grid-column: 1 / -1; border-bottom: 1px solid var(--line); }
  .cell:nth-child(2), .cell:nth-child(6) { border-left: 0; }
  .cell:nth-child(n + 6) { border-top: 1px solid var(--line); }
}
@media (max-width: 640px) {
  .band { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cell { padding: 11px 12px; }
  .cell:nth-child(6) { border-left: 1px solid var(--line); }
  .cell:nth-child(5) { border-left: 0; }
  .cell:nth-child(n + 5) { border-top: 1px solid var(--line); }
  .cell b { font-size: 16px; }
  /* the sections: two compact columns instead of a long list */
  .topics, .apps { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; --row: 64px; }
  .topics.gap { margin-top: 8px; }
}
</style>
