<script setup lang="ts">
const { data: o, error, updated, refresh } = useOverview()
usePoll(refresh, 5000)

const route = useRoute()
const NAV = [
  { to: '/', icon: 'home', label: 'Home' },
  { to: '/notes', icon: 'note', label: 'Notes' },
  { to: '/media', icon: 'media', label: 'Media' },
  { to: '/dev', icon: 'dev', label: 'Dev' },
  { to: '/servers', icon: 'gamepad', label: 'Servers' },
  { to: '/deals', icon: 'deals', label: 'Deals' },
  { to: '/wohnungen', icon: 'key', label: 'Flats' },
  { to: '/jobs', icon: 'briefcase', label: 'Jobs' },
  { to: '/money', icon: 'euro', label: 'Money' },
  { to: '/metrics', icon: 'metrics', label: 'Metrics' },
  { to: '/addons', icon: 'grid', label: 'Add-ons' },
  { to: '/chat', icon: 'chat', label: 'Chat' },
]
const problems = computed(() => alerts(o.value).filter(a => a.level === 'bad').length)
// switched-off add-ons (Add-ons page) drop out of the nav; pins keep them so turning one back on restores its tab
const { list, load: loadAddons, pageOn } = useAddons()
// pages of add-ons that moved out (addons/<id>/) come from their addon.yaml and slot in after Notes
NAV.splice(NAV.findIndex(n => n.to === '/notes') + 1, 0,
  ...list.filter(a => a.routes[0] && !NAV.some(n => n.to === a.routes[0])).map(a => ({ to: a.routes[0]!, icon: a.icon, label: a.name })))
onMounted(loadAddons)
const nav = computed(() => NAV.filter(n => pageOn(n.to)))
const badge = (to: string) => (to === '/metrics' ? problems.value : 0)
// chat: a pulsing dot while Claude works, an amber one when an answer waits on the owner's pick, on every page
const { chats, load: loadChats, save: saveChats, overall } = useChats()
const claude = useClaude(saveChats)
onMounted(() => {
  loadChats()
  for (const c of chats.value) for (const t of c.turns) if (t.ct && !t.fin) claude.attach(t)
})
// a turn started on another device shows up via sync: follow it here too
watch(() => chats.value.flatMap(c => c.turns.filter(t => t.ct && !t.fin && !t.busy).map(t => t.ct)).join(), () => {
  for (const c of chats.value) for (const t of c.turns) if (t.ct && !t.fin && !t.busy) claude.attach(t)
})
const mark = (to: string) => (to === '/chat' ? overall.value : '')
const markTitle = (m: string) => (m === 'input' ? 'a chat is waiting for your answer' : 'a chat is working')

// phone: four pinned tabs + "More" (a sheet with every page). Which four is the viewer's choice, kept in localStorage.
const MAX_PINS = 4
const PIN_KEY = 'nav:pinned'
const pinned = ref<string[]>(['/', '/media', '/dev', '/deals'])
try {
  const v = JSON.parse(localStorage.getItem(PIN_KEY) || 'null')
  if (Array.isArray(v)) { const ok = v.filter(x => NAV.some(n => n.to === x)).slice(0, MAX_PINS); if (ok.length) pinned.value = ok }
} catch {}
const tabs = computed(() => pinned.value.map(to => nav.value.find(n => n.to === to)!).filter(Boolean))
const here = computed(() => nav.value.find(n => n.to === route.path))
const offTab = computed(() => (here.value && !pinned.value.includes(here.value.to) ? here.value : null))
const moreBadge = computed(() => nav.value.filter(n => !pinned.value.includes(n.to)).reduce((s, n) => s + badge(n.to), 0))
const moreMark = computed(() => (pinned.value.includes('/chat') ? '' : overall.value))

const sheet = ref(false)
const editing = ref(false)
function openSheet() { editing.value = false; sheet.value = !sheet.value }
function togglePin(to: string) {
  const p = pinned.value
  if (p.includes(to)) { if (p.length > 1) pinned.value = p.filter(x => x !== to) }
  else if (p.length < MAX_PINS) pinned.value = NAV.map(n => n.to).filter(x => x === to || p.includes(x))
  try { localStorage.setItem(PIN_KEY, JSON.stringify(pinned.value)) } catch {}
}
function pick(to: string) { if (editing.value) togglePin(to); else { sheet.value = false; navigateTo(to) } }
watch(() => route.path, () => (sheet.value = false))
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') sheet.value = false }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

const tick = ref(Date.now())
let t: any
onMounted(() => (t = setInterval(() => (tick.value = Date.now()), 1000)))
onUnmounted(() => clearInterval(t))
const stale = computed(() => updated.value > 0 && tick.value - updated.value > 20000)
// one failed poll is a blip, not an outage: only call the agent down after 30 s of failures
const failSince = ref(0)
watch(error, e => (failSince.value = e ? (failSince.value || Date.now()) : 0))
const down = computed(() => failSince.value > 0 && tick.value - failSince.value > 30000)
const state = computed(() => (down.value ? 'bad' : stale.value ? 'warn' : 'ok'))
const stateText = computed(() => (down.value ? 'agent unreachable' : stale.value ? 'stale' : 'live'))
</script>

<template>
  <div class="shell">
    <aside class="side">
      <NuxtLink to="/" class="brand">
        <span class="logo">pve</span>
        <span class="dot" :class="state" :title="stateText" />
      </NuxtLink>
      <nav>
        <NuxtLink v-for="n in nav" :key="n.to" :to="n.to" :class="{ on: route.path === n.to }">
          <Icon :name="n.icon" class="i" /><span class="l">{{ n.label }}</span>
          <span v-if="badge(n.to)" class="badge">{{ badge(n.to) }}</span>
          <span v-if="mark(n.to)" class="cmark" :class="mark(n.to)" :title="markTitle(mark(n.to))" />
        </NuxtLink>
      </nav>
      <div class="foot small faint" :title="updated ? new Date(updated).toLocaleString() : ''">
        {{ o?.cts?.filter((c: any) => c.status === 'running').length ?? '–' }}/{{ o?.cts?.length ?? '–' }} up · {{ stateText }}
      </div>
    </aside>

    <div class="tabs" role="navigation" :class="{ lifted: sheet }">
      <NuxtLink v-for="n in tabs" :key="n.to" :to="n.to" :class="{ on: route.path === n.to && !sheet }">
        <Icon :name="n.icon" class="i" /><span class="l">{{ n.short ?? n.label }}</span>
        <span v-if="badge(n.to)" class="badge">{{ badge(n.to) }}</span>
        <span v-if="mark(n.to)" class="cmark" :class="mark(n.to)" />
      </NuxtLink>
      <button type="button" :class="{ on: offTab || sheet }" :aria-expanded="sheet" @click="openSheet">
        <Icon :name="offTab && !sheet ? offTab.icon : 'grid'" class="i" /><span class="l">{{ offTab && !sheet ? (offTab.short ?? offTab.label) : 'More' }}</span>
        <span v-if="moreBadge" class="badge">{{ moreBadge }}</span>
        <span v-else-if="moreMark" class="cmark" :class="moreMark" />
      </button>
    </div>

    <Transition name="sheet">
      <div v-if="sheet" class="scrim" @click.self="sheet = false">
        <div class="sheet" role="dialog" aria-label="All pages">
          <div class="sheet-head">
            <span class="dot" :class="state" />
            <span class="small faint">{{ o?.cts?.filter((c: any) => c.status === 'running').length ?? '–' }}/{{ o?.cts?.length ?? '–' }} up · {{ stateText }}</span>
            <button type="button" class="edit" :class="{ on: editing }" @click="editing = !editing">{{ editing ? 'Done' : 'Edit tabs' }}</button>
          </div>
          <div v-if="editing" class="hint small faint">Tap to pin up to {{ MAX_PINS }} pages to the bar · {{ pinned.length }}/{{ MAX_PINS }}</div>
          <div class="pages">
            <button v-for="n in nav" :key="n.to" type="button" class="page"
              :class="{ on: route.path === n.to, pinned: pinned.includes(n.to), editing, full: editing && !pinned.includes(n.to) && pinned.length >= MAX_PINS }"
              @click="pick(n.to)">
              <span class="tile"><Icon :name="n.icon" :size="22" /></span>
              <span class="pl">{{ n.label }}</span>
              <span v-if="badge(n.to)" class="badge">{{ badge(n.to) }}</span>
              <span v-if="mark(n.to)" class="cmark" :class="mark(n.to)" />
              <span v-if="editing && pinned.includes(n.to)" class="pinmark"><Icon name="pin" :size="12" /></span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <main class="wrap">
      <!-- floats over the page so it never shifts content (chat scroll etc.) -->
      <Transition name="pop">
        <div v-if="state !== 'ok'" class="banner small" :class="state" role="status">{{ down ? 'Agent unreachable — data may be old' : 'Data is stale' }}</div>
      </Transition>
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 200px minmax(0, 1fr); min-height: 100vh; min-height: 100dvh; }
.side {
  position: sticky; top: 0; height: 100vh; height: 100dvh; display: flex; flex-direction: column; gap: 18px;
  padding: 22px 12px 16px; border-right: 1px solid var(--line); background: var(--bg);
}
.brand { display: flex; align-items: center; gap: 10px; padding: 0 10px; color: var(--text); }
.brand:hover { text-decoration: none; }
.logo { font-weight: 700; font-size: 19px; letter-spacing: -.02em; }
nav { display: flex; flex-direction: column; gap: 2px; }
nav a { position: relative; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; color: var(--muted); font-size: 14px; }
nav a:hover { color: var(--text); text-decoration: none; background: var(--panel); }
nav a.on { color: var(--text); background: var(--panel-2); font-weight: 500; }
nav a.on .i { color: var(--accent); }
.i { color: var(--faint); }
nav a:hover .i { color: var(--muted); }
.badge { margin-left: auto; background: var(--bad); color: #fff; border-radius: 999px; font-size: 10px; font-weight: 600; padding: 0 6px; line-height: 16px; }
.cmark { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.badge + .cmark { margin-left: 6px; }
.cmark.busy { background: var(--accent); animation: cpulse 1.4s ease-in-out infinite; }
.cmark.input { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
@keyframes cpulse { 50% { opacity: .3; transform: scale(.7); } }
.foot { margin-top: auto; padding: 0 10px; }
.banner {
  position: fixed; z-index: 60; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 10px); transform: translateX(-50%);
  padding: 6px 14px; border-radius: 999px; white-space: nowrap; pointer-events: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .35); backdrop-filter: blur(6px);
}
.pop-enter-active, .pop-leave-active { transition: opacity .2s, transform .2s; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translate(-50%, -8px); }
.banner.bad { background: var(--bad-soft); color: var(--bad); }
.banner.warn { background: var(--warn-soft); color: var(--warn); }

@media (max-width: 900px) and (min-width: 641px) {
  .shell { grid-template-columns: 64px minmax(0, 1fr); }
  .side { padding: 18px 8px; align-items: center; }
  .brand { padding: 0; flex-direction: column; gap: 6px; }
  .logo { font-size: 15px; }
  nav a { justify-content: center; padding: 10px; }
  .l, .foot { display: none; }
  .badge { position: absolute; top: 3px; right: 3px; padding: 0 4px; font-size: 9px; line-height: 13px; }
  .cmark { position: absolute; top: 6px; right: 6px; }
}

.tabs, .scrim { display: none; }

@media (max-width: 640px) {
  .shell { display: block; --tabbar: calc(58px + env(safe-area-inset-bottom)); }
  .side { display: none; }
  .tabs {
    position: fixed; z-index: 60; bottom: 0; left: 0; right: 0; display: flex;
    padding: 0 4px env(safe-area-inset-bottom); border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  }
  .tabs.lifted { background: var(--panel); }
  .tabs a, .tabs button {
    position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 9px 0 8px; font: inherit; font-size: 11px; color: var(--muted); background: none; border: 0; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .tabs a:hover { text-decoration: none; }
  .tabs .i { width: 22px; height: 22px; color: inherit; }
  .tabs .on { color: var(--accent); }
  .tabs .l { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tabs .badge { position: absolute; top: 4px; left: calc(50% + 6px); padding: 0 4px; font-size: 9px; line-height: 14px; }
  .tabs .cmark { position: absolute; top: 7px; left: calc(50% + 9px); margin: 0; }

  .scrim {
    display: block; position: fixed; z-index: 55; inset: 0; background: rgb(0 0 0 / .5);
  }
  .sheet {
    position: absolute; left: 0; right: 0; bottom: var(--tabbar); max-height: calc(100dvh - var(--tabbar) - 40px); overflow-y: auto;
    background: var(--panel); border-top: 1px solid var(--line); border-radius: 16px 16px 0 0; padding: 14px 16px 16px;
  }
  .sheet-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .edit { margin-left: auto; font: inherit; font-size: 13px; color: var(--muted); background: var(--panel-2); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; cursor: pointer; }
  .edit.on { color: var(--accent); border-color: var(--accent); }
  .hint { margin: -4px 0 10px; }
  .pages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 4px; }
  .page {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0;
    font: inherit; font-size: 12px; color: var(--muted); background: none; border: 0; border-radius: 12px; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .page:active { background: var(--panel-2); }
  .tile { display: grid; place-items: center; width: 50px; height: 50px; border-radius: 14px; background: var(--panel-2); border: 1px solid var(--line); color: var(--text); }
  .page.on { color: var(--text); }
  .page.on .tile { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); }
  .page.editing.pinned .tile { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--panel-2)); }
  .page.full { opacity: .4; }
  .pl { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .page .badge { position: absolute; top: 3px; left: calc(50% + 14px); padding: 0 5px; font-size: 10px; line-height: 16px; }
  .page .cmark { position: absolute; top: 6px; left: calc(50% + 18px); margin: 0; }
  .pinmark { position: absolute; top: 2px; left: calc(50% + 16px); display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: var(--bg); }

  .sheet-enter-active, .sheet-leave-active { transition: opacity .18s; }
  .sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform .22s cubic-bezier(.2, .8, .2, 1); }
  .sheet-enter-from, .sheet-leave-to { opacity: 0; }
  .sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(24px); }
}
</style>
