<script setup lang="ts">
/**
 * ⌘K / Ctrl+K (the search button on phones): one search over pages, apps, actions, containers, notes and chats.
 * Actions only open the confirm card (<ActionConfirm>); nothing runs from here. Add-ons add entries with
 * `palette:` in their addon.yaml. No match → ask the AI.
 */
interface Item { key: string, group: string, label: string, sub?: string, icon?: string, to?: string, href?: string, action?: { name: string, args: any }, words?: string }
const props = defineProps<{ nav: { to: string, icon: string, label: string }[] }>()
const open = useState('palette:open', () => false)
const q = ref('')
const sel = ref(0)
const input = ref<HTMLInputElement>()
const listEl = ref<HTMLElement>()

const { data: o } = useOverview()
const { list: addons, pageOn } = useAddons()
const { chats } = useChats()
const notes = ref<any[]>([])
const RECENT = 'palette:recent'
const recent = ref<string[]>([])

watch(open, async (v) => {
  if (!v) return
  q.value = ''; sel.value = 0
  try { recent.value = JSON.parse(localStorage.getItem(RECENT) || '[]') } catch {}
  await nextTick(); input.value?.focus()
  if (pageOn('/notes')) $fetch<any>('/api/notes').then(r => (notes.value = (r.notes ?? []).filter((n: any) => n.state === 'active'))).catch(() => {})
})

const items = computed<Item[]>(() => {
  const out: Item[] = []
  for (const n of props.nav) out.push({ key: `p:${n.to}`, group: 'Pages', label: n.label, icon: n.icon, to: n.to })
  for (const s of o.value?.services ?? []) {
    if (s.url) out.push({ key: `a:${s.name}`, group: 'Apps', label: s.name, sub: s.up === false ? 'down' : s.note, href: s.url, words: s.group })
  }
  const act = (key: string, label: string, name: string, args: any = {}, words = '') => out.push({ key: `x:${key}`, group: 'Actions', label, action: { name, args }, words, icon: actionIcon(name, args) })
  act('backup_all', 'Back up every container', 'backup_all', {}, 'backup vzdump all')
  act('apt_upgrade_all', 'Update everything (host + containers)', 'apt_upgrade_all', {}, 'apt upgrade packages')
  act('apt_upgrade:host', 'Update the host', 'apt_upgrade', { target: 'host' }, 'apt upgrade pve packages')
  act('sanoid', 'Snapshot now', 'unit_start', { unit: 'sanoid.service' }, 'zfs sanoid')
  act('syncoid', 'Replicate to the backup pool now', 'unit_start', { unit: 'syncoid.service' }, 'zfs syncoid')
  act('dash_deploy', 'Deploy to GitHub', 'dash_deploy', {}, 'release ship publish push github')
  if (o.value?.host?.shutdown) act('host_cancel', 'Cancel the scheduled shutdown/reboot', 'host_shutdown_cancel', {}, 'pve server host power')
  else {
    act('host_reboot', 'Reboot the server (in 1 min)', 'host_reboot', {}, 'pve host restart power')
    act('host_shutdown', 'Shut down the server (in 1 min)', 'host_shutdown', {}, 'pve host power off')
  }
  for (const p of o.value?.pools ?? []) if (p.name) act(`scrub:${p.name}`, `Scrub pool ${p.name}`, 'zfs_scrub', { pool: p.name }, 'zfs')
  for (const a of addons) {
    if (a.routes[0] && !pageOn(a.routes[0])) continue
    const entries: any[] = Array.isArray(a.palette) ? a.palette : []
    entries.forEach((e, i) => {
      const base = { key: `e:${a.id}:${i}`, label: e.label, icon: e.icon ?? a.icon, sub: a.label || a.name, words: e.keywords }
      if (e.action) out.push({ ...base, icon: e.icon ?? actionIcon(e.action, e.args), group: 'Actions', action: { name: e.action, args: e.args ?? {} } })
      else if (e.to) out.push({ ...base, group: 'Pages', to: e.to })
    })
  }
  for (const c of o.value?.cts ?? []) {
    const name = `${c.name} (${c.vmid})`
    const up = c.status === 'running'
    out.push({ key: `c:${c.vmid}`, group: 'Containers', label: name, sub: c.status, to: '/metrics#containers', words: `ct ${c.vmid}` })
    if (up) {
      act(`reboot:${c.vmid}`, `Reboot ${name}`, 'ct_reboot', { vmid: c.vmid }, 'restart ct container')
      act(`shutdown:${c.vmid}`, `Shut down ${name}`, 'ct_shutdown', { vmid: c.vmid }, 'stop ct container')
      act(`backup:${c.vmid}`, `Back up ${name}`, 'backup_ct', { vmid: c.vmid }, 'vzdump ct container')
    } else act(`start:${c.vmid}`, `Start ${name}`, 'ct_start', { vmid: c.vmid }, 'boot ct container')
  }
  for (const n of notes.value) out.push({ key: `n:${n.id}`, group: 'Notes', label: n.title || 'Untitled', sub: n.topic, icon: 'note', to: `/notes?n=${n.id}`, words: n.body?.slice(0, 400) })
  if (pageOn('/chat')) for (const c of chats.value) out.push({ key: `h:${c.id}`, group: 'Chats', label: c.title || 'New chat', icon: 'chat', to: `/chat?c=${c.id}`, words: c.turns?.[0]?.q?.slice(0, 200) })
  return out
})

/** one icon per kind of action, so a reboot doesn't look like a backup */
function actionIcon(name: string, args: any) {
  if (name.startsWith('backup')) return 'archive'
  if (name.startsWith('apt_upgrade')) return 'download'
  if (name === 'ct_start') return 'play'
  if (name === 'ct_reboot' || name === 'host_reboot') return 'refresh'
  if (name === 'zfs_scrub') return 'shield'
  if (name === 'unit_start') return args?.unit?.startsWith('syncoid') ? 'copy' : 'layers'
  if (name === 'host_shutdown_cancel') return 'clock'
  if (name === 'dash_deploy') return 'send'
  return 'power'
}
const GROUPS = ['Recent', 'Pages', 'Apps', 'Actions', 'Containers', 'Notes', 'Chats']
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
function score(it: Item, words: string[]) {
  const label = norm(it.label)
  const hay = `${label} ${norm(it.sub ?? '')} ${norm(it.words ?? '')} ${norm(it.group)}`
  if (!words.every(w => hay.includes(w))) return -1
  let s = 0
  if (label.startsWith(words[0]!)) s += 30
  else if (label.split(/[\s(/-]+/).some(p => p.startsWith(words[0]!))) s += 18
  if (words.every(w => label.includes(w))) s += 10
  const r = recent.value.indexOf(it.key)
  if (r >= 0) s += 12 - r
  return s
}

const results = computed(() => {
  const words = norm(q.value.trim()).split(/\s+/).filter(Boolean)
  const groups: { name: string, items: Item[] }[] = []
  if (!words.length) {
    const byKey = new Map(items.value.map(i => [i.key, i]))
    const rec = recent.value.map(k => byKey.get(k)).filter(Boolean).slice(0, 6) as Item[]
    if (rec.length) groups.push({ name: 'Recent', items: rec })
    groups.push({ name: 'Pages', items: items.value.filter(i => i.group === 'Pages' && !rec.includes(i)) })
    return groups
  }
  const hits = items.value.map(i => ({ i, s: score(i, words) })).filter(x => x.s >= 0)
  for (const g of GROUPS) {
    const gi = hits.filter(x => x.i.group === g).sort((a, b) => b.s - a.s).slice(0, g === 'Actions' || g === 'Notes' ? 8 : 6).map(x => x.i)
    if (gi.length) groups.push({ name: g, items: gi })
  }
  return groups
})
const askItem = computed<Item | null>(() => (q.value.trim() && pageOn('/chat') ? { key: 'ask', group: 'Ask', label: `Ask AI about “${q.value.trim()}”`, icon: 'spark', to: `/chat?ask=${encodeURIComponent(q.value.trim())}` } : null))
const flat = computed(() => {
  const f = results.value.flatMap(g => g.items)
  // no match → asking the AI is the first (and only) choice; otherwise it waits at the end
  return askItem.value ? [...f, askItem.value] : f
})
watch(q, () => (sel.value = 0))

function choose(it: Item) {
  if (it.key !== 'ask') {
    recent.value = [it.key, ...recent.value.filter(k => k !== it.key)].slice(0, 12)
    try { localStorage.setItem(RECENT, JSON.stringify(recent.value)) } catch {}
  }
  open.value = false
  if (it.action) useConfirm().ask(it.action.name, it.action.args, it.label)
  else if (it.href) window.open(it.href, '_blank', 'noopener')
  else if (it.to) navigateTo(it.to)
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); sel.value = Math.min(flat.value.length - 1, sel.value + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel.value = Math.max(0, sel.value - 1) }
  else if (e.key === 'Enter') { e.preventDefault(); const it = flat.value[sel.value]; if (it) choose(it) }
  else if (e.key === 'Escape') open.value = false
  else return
  nextTick(() => listEl.value?.querySelector('.it.sel')?.scrollIntoView({ block: 'nearest' }))
}
const onGlobal = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open.value = !open.value } }
onMounted(() => window.addEventListener('keydown', onGlobal))
onUnmounted(() => window.removeEventListener('keydown', onGlobal))
const idx = (it: Item) => flat.value.indexOf(it)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pal-scrim" @click.self="open = false">
      <div class="pal" role="dialog" aria-label="Search">
        <div class="search">
          <Icon name="search" :size="17" class="si" />
          <input
            ref="input" v-model="q" type="search" placeholder="Search pages, apps, actions, notes…"
            autocomplete="off" enterkeyhint="go" aria-label="Search" @keydown="onKey"
          >
          <button type="button" class="btn ghost sm" aria-label="Close" @click="open = false">Esc</button>
        </div>
        <div ref="listEl" class="list">
          <div v-for="g in results" :key="g.name" class="grp">
            <div class="gh small faint">{{ g.name }}</div>
            <button
              v-for="it in g.items" :key="it.key" type="button" class="it" :class="{ sel: idx(it) === sel }"
              @click="choose(it)" @mousemove="sel = idx(it)"
            >
              <span class="ic"><Icon :name="it.icon ?? (it.action ? 'power' : it.href ? 'ext' : 'arrow')" :size="15" /></span>
              <span class="lb">{{ it.label }}</span>
              <span v-if="it.sub" class="sb small faint">{{ it.sub }}</span>
              <span v-if="it.action" class="pill warn">confirm</span>
            </button>
          </div>
          <div v-if="askItem" class="grp">
            <div v-if="!results.length" class="gh small faint">Nothing found</div>
            <button type="button" class="it ask" :class="{ sel: idx(askItem) === sel }" @click="choose(askItem)" @mousemove="sel = idx(askItem)">
              <span class="ic"><Icon name="spark" :size="15" /></span>
              <span class="lb">{{ askItem.label }}</span>
            </button>
          </div>
          <div v-else-if="!results.length" class="empty-state small">Nothing found.</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pal-scrim { position: fixed; inset: 0; z-index: 85; background: rgb(0 0 0 / .5); display: flex; justify-content: center; align-items: flex-start; padding: 10vh 12px 0; }
.pal { width: min(620px, 100%); max-height: 70vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line-2); border-radius: var(--radius); box-shadow: 0 20px 50px rgb(0 0 0 / .55); overflow: hidden; }
.search { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--line); }
.si { color: var(--faint); }
.search input { flex: 1; min-width: 0; background: transparent !important; border: 0 !important; padding: 8px 0; font-size: 15px; }
.search input::-webkit-search-cancel-button { display: none; }
.list { overflow-y: auto; padding: 4px 6px 8px; overscroll-behavior: contain; }
.gh { padding: 10px 8px 4px; }
.it { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 38px; padding: 6px 8px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.it.sel { background: var(--panel-2); }
.ic { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 7px; background: var(--panel-2); color: var(--muted); flex: none; }
.it.sel .ic { color: var(--accent); background: var(--accent-soft); }
.lb { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb { margin-left: auto; min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb + .pill { margin-left: 6px; }
.lb + .pill { margin-left: auto; }
.ask .lb { color: var(--accent); }
@media (max-width: 640px) {
  .pal-scrim { padding: calc(env(safe-area-inset-top, 0px) + 8px) 8px 0; }
  .pal { max-height: calc(100dvh - var(--tabbar, 0px) - 24px); }
  .it { min-height: 44px; }
}
</style>
