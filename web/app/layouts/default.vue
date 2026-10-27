<script setup lang="ts">
const { data: o, error, updated, refresh } = useOverview()
usePoll(refresh, 5000)

const route = useRoute()
// the core pages; every other tab is an add-on (addons/<id>/addon.yaml) and slots in by its `order`
const NAV: { to: string, icon: string, label: string }[] = [
  { to: '/', icon: 'home', label: 'Home' },
  { to: '/metrics', icon: 'metrics', label: 'Metrics' },
  { to: '/addons', icon: 'grid', label: 'Add-ons' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
]
const problems = computed(() => alerts(o.value).filter(a => a.level === 'bad').length)
// switched-off add-ons (Add-ons page) drop out of the nav; pins keep them so turning one back on restores its tab
const { list, load: loadAddons, pageOn } = useAddons()
// add-on tabs go between Home and Metrics; order ≥ 90 (Chat) goes after Add-ons, at the end
const tab = (a: Addon) => ({ to: a.routes[0]!, icon: a.icon, label: a.label || a.name })
const withPage = list.filter(a => a.routes[0])
NAV.splice(1, 0, ...withPage.filter(a => (a.order ?? 100) < 90).map(tab))
NAV.push(...withPage.filter(a => (a.order ?? 100) >= 90).map(tab))
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

// phone: four pinned tabs + "More" (a sheet with every page). Which four is the viewer's choice (useNavPins, shared with skins).
const { keys: pinned, pinned: tabs, toggle: togglePin, editing, max: MAX_PINS } = useNavPins(() => nav.value)
const here = computed(() => nav.value.find(n => n.to === route.path))
const offTab = computed(() => (here.value && !pinned.value.includes(here.value.to) ? here.value : null))
const moreBadge = computed(() => nav.value.filter(n => !pinned.value.includes(n.to)).reduce((s, n) => s + badge(n.to), 0))
const moreMark = computed(() => (pinned.value.includes('/chat') ? '' : overall.value))

const sheet = ref(false)
function openSheet() { editing.value = false; sheet.value = !sheet.value }
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

// command palette (⌘K, the search buttons), the jobs tray + toasts, pull-to-refresh on phones
const palette = useState('palette:open', () => false)
const { restore } = useRuns()
onMounted(restore)
// pages that fill the screen and scroll inside themselves: no top bar, no pull
const FULL = ['/chat']
const full = computed(() => FULL.includes(route.path))
const pull = usePull(() => full.value || sheet.value || palette.value || route.path === '/dev')
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const stateText = computed(() => (down.value ? 'agent unreachable' : stale.value ? 'stale' : 'live'))
// a skin (Designs add-on) may bring its own navigation; it gets the same pages, badges and live state
const SkinNav = useSkinned('Nav')
// …and may paint a full-page backdrop behind everything, and frame each page (title, chrome, layout)
const SkinBackdrop = useSkinned('Backdrop')
const SkinFrame = useSkinned('Frame')
const upText = computed(() => `${o.value?.cts?.filter((c: any) => c.status === 'running').length ?? '–'}/${o.value?.cts?.length ?? '–'} up`)
</script>

<template>
  <div class="shell" :class="{ skinned: SkinNav }">
    <component :is="SkinBackdrop" v-if="SkinBackdrop" :path="route.path" />
    <component :is="SkinNav" v-if="SkinNav" :nav="nav" :path="route.path" :badge="badge" :mark="mark" :state="state" :state-text="stateText" :up="upText" :full="full" @search="palette = true" />
    <template v-else>
    <aside class="side">
      <NuxtLink to="/" class="brand">
        <span class="logo">bastion</span>
        <span class="dot" :class="state" :title="stateText" />
      </NuxtLink>
      <button type="button" class="find" @click="palette = true">
        <Icon name="search" :size="16" class="i" /><span class="l">Search</span><kbd class="l">{{ mac ? 'Cmd' : 'Ctrl' }} K</kbd>
      </button>
      <nav>
        <NuxtLink v-for="n in nav" :key="n.to" :to="n.to" :class="{ on: route.path === n.to }">
          <Icon :name="n.icon" class="i" /><span class="l">{{ n.label }}</span>
          <span v-if="badge(n.to)" class="badge">{{ badge(n.to) }}</span>
          <span v-if="mark(n.to)" class="cmark" :class="mark(n.to)" :title="markTitle(mark(n.to))" />
        </NuxtLink>
      </nav>
      <div class="side-jobs"><JobsButton /></div>
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
            <button type="button" class="edit" aria-label="Search" @click="sheet = false; palette = true"><Icon name="search" :size="15" /></button>
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

    <div v-if="!full" class="topbar">
      <NuxtLink to="/" class="brand"><span class="logo">bastion</span><span class="dot" :class="state" /></NuxtLink>
      <JobsButton />
      <button type="button" class="btn icon ghost" aria-label="Search" @click="palette = true"><Icon name="search" :size="19" /></button>
    </div>
    </template>
    <div v-if="pull.dist.value" class="ptr" :class="{ ready: pull.ready.value, busy: pull.busy.value }" :style="{ transform: `translate(-50%, ${pull.dist.value}px)` }">
      <Icon name="refresh" :size="18" :style="{ transform: `rotate(${pull.dist.value * 3}deg)` }" />
    </div>

    <CommandPalette :nav="nav" />
    <JobsTray />
    <ActionConfirm />
    <Toasts />
    <OfflinePill />

    <main class="wrap" :class="{ refreshing: pull.busy.value }">
      <!-- floats over the page so it never shifts content (chat scroll etc.) -->
      <Transition name="pop">
        <div v-if="state !== 'ok'" class="banner small" :class="state" role="status">{{ down ? 'Agent unreachable — data may be old' : 'Data is stale' }}</div>
      </Transition>
      <component :is="SkinFrame" v-if="SkinFrame" :path="route.path" :title="here?.label ?? ''" :icon="here?.icon ?? ''"><slot /></component>
      <slot v-else />
    </main>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 200px minmax(0, 1fr); min-height: 100vh; min-height: 100dvh; }
.shell.skinned { display: block; }
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
.side-jobs { padding: 0 4px; }
.side-jobs:empty { display: none; }
.find {
  display: flex; align-items: center; gap: 10px; margin: -6px 0 -8px; padding: 7px 10px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--panel); color: var(--faint); font: inherit; font-size: 13px; cursor: pointer;
}
.find:hover { color: var(--text); border-color: var(--line-2); }
.find kbd { margin-left: auto; font: 11px var(--mono); color: var(--faint); }
.topbar, .ptr { display: none; }
main.refreshing { opacity: .55; transition: opacity .2s; pointer-events: none; }
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
  .find { justify-content: center; padding: 9px; margin: 0; }
  .side-jobs :deep(.jt) { padding: 6px 8px; }
  .badge { position: absolute; top: 3px; right: 3px; padding: 0 4px; font-size: 9px; line-height: 13px; }
  .cmark { position: absolute; top: 6px; right: 6px; }
}

.tabs, .scrim { display: none; }

@media (max-width: 640px) {
  .shell { display: block; --tabbar: calc(58px + env(safe-area-inset-bottom)); }
  .side { display: none; }
  .topbar {
    display: flex; align-items: center; gap: 8px; padding: calc(env(safe-area-inset-top, 0px) + 6px) 8px 0 14px;
    max-width: 1320px; margin: 0 auto;
  }
  .topbar .brand { padding: 0; margin-right: auto; }
  .topbar .logo { font-size: 17px; }
  .topbar ~ .wrap { padding-top: 4px; }
  /* a page-sized floor: switching tabs no longer shrinks the page, so the browser's bottom bar doesn't jump */
  .wrap { min-height: calc(100dvh - var(--tabbar)); }
  .ptr {
    display: grid; place-items: center; position: fixed; z-index: 65; left: 50%; top: calc(env(safe-area-inset-top, 0px) - 30px);
    width: 36px; height: 36px; border-radius: 50%; background: var(--panel-2); border: 1px solid var(--line-2); color: var(--faint);
    box-shadow: 0 4px 14px rgb(0 0 0 / .4);
  }
  .ptr.ready { color: var(--accent); }
  .ptr.busy svg { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sheet-head .edit:first-of-type { margin-left: auto; display: grid; place-items: center; padding: 5px 9px; }
  .sheet-head .edit + .edit { margin-left: 0; }
  .tabs {
    position: fixed; z-index: 60; bottom: 0; left: 0; right: 0; display: flex;
    padding: 0 4px env(safe-area-inset-bottom); border-top: 1px solid var(--line);
    /* solid, no backdrop-filter: the blur is repainted on every scroll and tab change and made switching lag on Android */
    background: var(--bg);
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
