<script setup lang="ts">
useHead({ title: 'Bastion' })
const { t } = useI18n()
const { data: o, error, refresh } = useOverview()

const list = computed(() => alerts(o.value))
const apps = computed(() => (o.value?.services ?? []).filter((s: any) => s.group === 'app'))
const down = computed(() => apps.value.filter((s: any) => !s.up).length)

const running = computed(() => (o.value?.cts ?? []).filter((c: any) => c.status === 'running').length)
const updates = computed(() => (o.value?.updates?.host?.count ?? 0)
  + Object.values(o.value?.updates?.cts ?? {}).reduce((s: number, u: any) => s + (u?.count ?? 0), 0))

/** the glance band — the house in a handful of numbers */
const loadTone = (p: number) => (p > 95 ? 'bad' : p > 85 ? 'warn' : '')
const cpuP = computed(() => o.value?.host?.cpu ?? 0)
const ramP = computed(() => (o.value ? pct(o.value.host.mem.used, o.value.host.mem.total) : 0))
const gpuP = computed(() => o.value?.gpu?.util ?? 0)
const band = computed<{ label: string, value: string | number, tone?: string, meter?: number }[]>(() => [
  { label: 'CPU', value: o.value ? `${Math.round(cpuP.value)}%` : '–', tone: loadTone(cpuP.value), meter: o.value ? cpuP.value : undefined },
  { label: 'RAM', value: o.value ? `${ramP.value.toFixed(0)}%` : '–', tone: loadTone(ramP.value), meter: o.value ? ramP.value : undefined },
  { label: 'GPU', value: o.value?.gpu ? `${gpuP.value}%` : '–', tone: loadTone(gpuP.value), meter: o.value?.gpu ? gpuP.value : undefined },
  { label: t('tabs.containers'), value: o.value ? `${running.value}/${o.value.cts.length}` : '–', tone: o.value && running.value < o.value.cts.length ? 'warn' : '' },
  { label: t('host.updates'), value: o.value ? updates.value : '–', tone: updates.value ? 'warn' : '' },
  { label: t('home.uptimeShort'), value: o.value ? duration(o.value.host.uptime) : '–' },
])
const health = computed(() => {
  if (!o.value) return { tone: '', text: t('common.loading') }
  const bad = list.value.filter(a => a.level === 'bad').length
  if (bad) return { tone: 'bad', text: t('home.problems', bad) }
  if (list.value.length) return { tone: 'warn', text: t('home.toCheck', { n: list.value.length }) }
  return { tone: 'ok', text: t('home.allGood') }
})

// Sections: one card per add-on that brings one (addon.yaml `home: true` → its Home<Id>.global.vue), in tab
// order; Metrics is core. Chat sits last like in the nav.
const { list: addons, pageOn } = useAddons()
const pascal = (id: string) => id.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join('')
const cards = computed(() => addons.filter(a => a.home && a.routes[0] && pageOn(a.routes[0])).map(a => ({ id: a.id, order: a.order ?? 100, comp: `Home${pascal(a.id)}` })))
// the viewer's layout (Edit): one `order` of tile keys (app:<name> / card:<id>), hidden tiles and sizes, synced across
// devices (useSynced). 'home' is the shared one; each kind of device may keep its own ('home:phone', own: true) instead.
// sizes: grid cells per item (columns × rows); an item's default size isn't stored. Older layouts kept 's' / 'l'
// there, and apps / cards / pinned (separate lists) before `order` existed: they are only read to build the first order.
interface Box { w: number, h: number }
interface HomeLayout { order: string[], apps: string[], cards: string[], pinned: string[], hidden: string[], sizes: Record<string, Box | 's' | 'l'> }
const EMPTY: HomeLayout = { order: [], apps: [], cards: [], pinned: [], hidden: [], sizes: {} }
const device = deviceKind()
const shared = useSynced<HomeLayout>('home', () => ({ ...EMPTY }))
const mine = useSynced<HomeLayout & { own?: boolean }>(`home:${device}`, () => ({ ...EMPTY }))
const own = computed(() => !!mine.value.value?.own)
const pref = computed<HomeLayout>(() => {
  const { own: _, ...l } = (own.value ? mine.value.value : shared.value.value) ?? EMPTY
  return l
})
const draft = ref<HomeLayout | null>(null) // while a drag is under way
const lay = computed<HomeLayout>(() => ({ ...EMPTY, ...(draft.value ?? pref.value ?? {}) }))
const editing = ref(false)
// the tile whose frame is showing in edit mode (its key)
const selected = ref('')
watch(editing, () => { selected.value = '' })
// the Ask bar needs admin, the Home layout is the owner's (shared/utils/roles.ts)
const { role } = useAddons()
const canRole = (need: 'viewer' | 'member' | 'admin' | 'owner') => !role.value || atLeast(role.value, need)
const save = (l: HomeLayout) => { draft.value = null; own.value ? mine.set({ ...l, own: true }) : shared.set(l) }
// "Only this phone": starts from the shared layout; back to "Same everywhere" keeps it for next time
const setOwn = (on: boolean) => { if (on !== own.value) mine.set(on ? { ...(mine.upd.value ? mine.value.value : pref.value), own: true } : { ...mine.value.value, own: false }) }

interface Item { id: string, key: string, s?: any, comp?: string }
const appItems = computed<Item[]>(() => apps.value.map((s: any) => ({ id: s.name, key: `app:${s.name}`, s })))
const cardItems = computed<Item[]>(() => [
  ...cards.value.filter(c => c.order < 90).map(c => ({ id: c.id, key: `card:${c.id}`, comp: c.comp })),
  { id: 'metrics', key: 'card:metrics' },
  { id: 'power', key: 'card:power', comp: 'HomePower' },
  ...cards.value.filter(c => c.order >= 90).map(c => ({ id: c.id, key: `card:${c.id}`, comp: c.comp })),
])
// every tile in one sequence: the saved order (first time: pinned, apps, cards of the old layout), then whatever is new
const items = computed<Item[]>(() => {
  const l = lay.value
  const all = new Map([...appItems.value, ...cardItems.value].map(i => [i.key, i]))
  const base = l.order?.length ? l.order : [...l.pinned, ...l.apps.map(n => 'app:' + n), ...l.cards.map(id => 'card:' + id)]
  const out: Item[] = []
  for (const k of [...base, ...all.keys()]) {
    const it = all.get(k)
    if (it) { out.push(it); all.delete(k) }
  }
  return out.filter(shown)
})
function shown(it: Item) { return editing.value || !lay.value.hidden.includes(it.key) }
// what gets saved: the order on screen, plus the keys of tiles that are not there right now (an add-on switched off)
const orderOf = (keys: string[]) => [...keys, ...(lay.value.order ?? []).filter(k => !keys.includes(k))]
const board = ref<HTMLElement>()
const { dragKey, start, flip } = useGridDrag({
  board,
  keys: () => items.value.map(i => i.key),
  draft: keys => { draft.value = keys ? { ...lay.value, order: orderOf(keys) } : null },
  commit: keys => save({ ...lay.value, order: orderOf(keys) }),
})
function moveBy(key: string, d: number) {
  const keys = items.value.map(i => i.key)
  const i = keys.indexOf(key), j = i + d
  if (i < 0 || j < 0 || j >= keys.length) return
  ;[keys[i], keys[j]] = [keys[j]!, keys[i]!]
  flip(() => save({ ...lay.value, order: orderOf(keys) }))
}
const toggleHidden = (key: string) => {
  const l = { ...lay.value, order: orderOf(items.value.map(i => i.key)) }
  l.hidden = l.hidden.includes(key) ? l.hidden.filter(k => k !== key) : [...l.hidden, key]
  save(l)
}
const isHidden = (it: Item) => lay.value.hidden.includes(it.key)
const custom = computed(() => Object.values(lay.value).some(v => (Array.isArray(v) ? v.length : Object.keys(v).length)))
// defaults: apps 2×1, cards 2×2 (the power card 2×1)
const defaultBox = (key: string): Box => (key.startsWith('app:') || key === 'card:power' ? { w: 2, h: 1 } : { w: 2, h: 2 })
const boxOf = (key: string): Box => {
  const v = lay.value.sizes[key]
  return v === 's' ? { w: 1, h: 1 } : v === 'l' ? { w: 4, h: 2 } : v ?? defaultBox(key)
}
// the handles and presets report every step; the draft shows it, release saves
function resize(key: string, b: Box) {
  const sizes = { ...lay.value.sizes }
  const d = defaultBox(key)
  if (b.w === d.w && b.h === d.h) delete sizes[key]
  else sizes[key] = b
  draft.value = { ...lay.value, order: orderOf(items.value.map(i => i.key)), sizes }
}
const { armed, arm } = useArm()
const reset = () => { if (arm('reset')) save({ ...EMPTY }) }
const bind = (it: Item) => ({
  it, editing: editing.value, hidden: isHidden(it), drag: dragKey.value === it.key,
  selected: selected.value === it.key, chips: metricsChips.value, more: metricsMore.value, bars: metricsBars.value,
  box: boxOf(it.key),
  onGrab: (e: PointerEvent, el: HTMLElement) => { selected.value = it.key; start(e, it.key, el) },
  onSelect: () => { selected.value = selected.value === it.key ? '' : it.key }, onHide: () => toggleHidden(it.key),
  onMove: (d: number) => moveBy(it.key, d),
  onResize: (b: Box) => resize(it.key, b), onResized: () => { if (draft.value) save(draft.value) },
})

// the Metrics card when it's large
const metricsMore = computed(() => o.value
  ? [
      ...band.value.slice(0, 3).map(b => ({ text: b.label, sub: String(b.value), tone: b.tone })),
      ...list.value.slice(0, 3).map(a => ({ text: a.text, tone: a.level })),
    ]
  : [])
// CPU, RAM, GPU when there is one, and the fullest storage pool
const metricsBars = computed(() => {
  if (!o.value) return []
  const bar = (label: string, v: number) => ({ label, value: Math.max(0, Math.min(100, v)), text: `${Math.round(v)}%`, tone: loadTone(v) })
  const out = [bar('CPU', cpuP.value), bar('RAM', ramP.value)]
  if (o.value.gpu) out.push(bar('GPU', gpuP.value))
  const pools = (o.value.pools ?? []).filter((p: any) => p.size)
  const full = pools.sort((a: any, b: any) => pct(b.alloc, b.size) - pct(a.alloc, a.size))[0]
  if (full) out.push(bar(full.name, pct(full.alloc, full.size)))
  return out
})
const metricsChips = computed(() => o.value
  ? [
      { text: health.value.text, tone: health.value.tone },
      ...(list.value.length ? [{ text: `${list.value.length} alerts`, tone: list.value.some(a => a.level === 'bad') ? 'bad' : 'warn' }] : []),
      ...(updates.value ? [{ text: `${updates.value} updates`, tone: 'warn' }] : [{ text: 'up to date' }]),
    ]
  : [])
</script>

<template>
  <div :class="{ 'pg-edit': editing }">
    <h1 class="sr-only">{{ $t('nav.home') }}</h1>
    <AskPanel
      scope="home" placeholder="Ask anything about the house server…"
      :examples="['Is everything working?', 'What is new on Jellyfin?', 'Anything I should fix?', 'What is the weather today?']"
      @refresh="refresh"
    />

    <div v-if="error && !o" class="bad pad">
      {{ $t('common.agentErr', { msg: error.statusMessage || error.message }) }}
      <div><button type="button" class="btn sm" @click="refresh()">{{ $t('common.retry') }}</button></div>
    </div>

    <Skeleton v-if="!o && !error" kind="band" :n="7" class="band-sk" />
    <div v-else class="band">
      <div class="cell health" :class="health.tone">
        <span class="dot" :class="health.tone" />
        <div class="hc">
          <b>{{ health.text }}</b>
          <span v-if="o" class="sub faint">{{ list[0]?.text ?? $t('home.uptime', { t: duration(o.host.uptime) }) }}</span>
        </div>
      </div>
      <div v-for="b in band" :key="b.label" class="cell">
        <span class="lbl">{{ b.label }}</span>
        <b :class="b.tone">{{ b.value }}</b>
        <span v-if="b.meter != null" class="meter" :class="b.tone"><i :style="{ transform: `scaleX(${Math.max(0, Math.min(100, b.meter)) / 100})` }" /></span>
      </div>
    </div>
    <AlertsBar :items="list" />

    <h2 class="sec">
      <span class="lbl-q">{{ $t('home.tiles') }}</span>
      <span v-if="down" class="bad small">{{ $t('home.nDown', { n: down }) }}</span>
      <span class="edit-row">
        <button v-if="canRole('owner') && !editing" type="button" class="btn sm ghost" @click="editing = true">{{ $t('common.edit') }}</button>
      </span>
    </h2>
    <Skeleton v-if="!o && !error" kind="tiles" :n="6" />
    <div v-else ref="board" class="board">
      <HomeItem v-for="it in items" :key="it.key" v-bind="bind(it)" />
    </div>

    <Teleport to="body">
      <Transition name="ebar">
        <div v-if="editing" class="ebar" role="toolbar">
          <span class="small faint hint">{{ $t('home.editHint') }}</span>
          <div class="seg">
            <button type="button" :class="{ on: !own }" @click="setOwn(false)">{{ $t('home.layoutShared') }}</button>
            <button type="button" :class="{ on: own }" @click="setOwn(true)">{{ $t(`home.layoutOwn.${device}`) }}</button>
          </div>
          <button v-if="custom" type="button" class="btn sm" :class="{ sure: armed === 'reset' }" @click="reset">{{ armed === 'reset' ? $t('common.sure') : $t('home.resetLayout') }}</button>
          <button type="button" class="btn sm primary" @click="editing = false">{{ $t('common.done') }}</button>
        </div>
      </Transition>
    </Teleport>
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

/* one grid of cells: every tile spans its own columns × rows (HomeItem) and its content fits itself to that */
.board { --row: 72px; display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); grid-auto-rows: var(--row); grid-auto-flow: row dense; gap: 10px; }
@media (max-width: 1250px) { .board { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@media (max-width: 900px) { .board { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.band-sk { margin-bottom: 14px; }
.edit-row { margin-left: auto; display: flex; gap: 6px; align-self: center; }
.lbl-q { color: var(--muted); font-weight: 500; }
.pg-edit { padding-bottom: 120px; }
.hc { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.hc .sub { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meter { display: block; height: 3px; margin-top: 5px; border-radius: 2px; background: var(--track); overflow: hidden; }
.meter i { display: block; height: 100%; width: 100%; background: var(--accent); transform-origin: left; transition: transform .4s var(--ease-out, ease-out); }
.meter.warn i { background: var(--warn); }
.meter.bad i { background: var(--bad); }

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
  /* four compact columns instead of a long list */
  .board { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; --row: 64px; }
}

/* edit mode: a bar fixed at the bottom of the viewport (teleported to body) */
.ebar {
  position: fixed; left: 50%; bottom: 16px; translate: -50% 0; z-index: 30; width: calc(100% - 24px); max-width: 560px;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 10px; padding: 8px 12px;
  background: var(--panel-2); border: 1px solid var(--line-2); border-radius: 22px; box-shadow: 0 4px 16px rgb(0 0 0 / .35);
}
.ebar .hint { flex: 1 1 100%; text-align: center; }
.ebar-enter-active, .ebar-leave-active { transition: opacity .18s var(--ease-out, ease-out), transform .18s var(--ease-out, ease-out); }
.ebar-enter-from, .ebar-leave-to { opacity: 0; transform: translateY(12px); }
@media (max-width: 640px) { .ebar { bottom: calc(var(--tabbar, 0px) + 12px); } }
@media (prefers-reduced-motion: reduce) { .ebar-enter-active, .ebar-leave-active, .meter i { transition: none; } }
</style>
