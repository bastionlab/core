<script setup lang="ts">
const { data: o, error, updated, refresh } = useOverview()
usePoll(refresh, 5000)

const route = useRoute()
const nav = [
  { to: '/', icon: 'home', label: 'Home' },
  { to: '/media', icon: 'media', label: 'Media' },
  { to: '/dev', icon: 'dev', label: 'Dev' },
  { to: '/deals', icon: 'deals', label: 'Deals' },
  { to: '/wohnungen', icon: 'key', label: 'Wohnungen', short: 'Wohnen' },
  { to: '/metrics', icon: 'metrics', label: 'Metrics' },
  { to: '/chat', icon: 'chat', label: 'Chat' },
]
const problems = computed(() => alerts(o.value).filter(a => a.level === 'bad').length)

const tick = ref(Date.now())
let t: any
onMounted(() => (t = setInterval(() => (tick.value = Date.now()), 1000)))
onUnmounted(() => clearInterval(t))
const stale = computed(() => updated.value > 0 && tick.value - updated.value > 20000)
const state = computed(() => (error.value ? 'bad' : stale.value ? 'warn' : 'ok'))
const stateText = computed(() => (error.value ? 'agent unreachable' : stale.value ? 'stale' : 'live'))
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
          <Icon :name="n.icon" class="i" /><span class="l">{{ n.label }}</span><span class="l short">{{ n.short ?? n.label }}</span>
          <span v-if="n.to === '/metrics' && problems" class="badge">{{ problems }}</span>
        </NuxtLink>
      </nav>
      <div class="foot small faint" :title="updated ? new Date(updated).toLocaleString() : ''">
        {{ o?.cts?.filter((c: any) => c.status === 'running').length ?? '–' }}/{{ o?.cts?.length ?? '–' }} up · {{ stateText }}
      </div>
    </aside>

    <main class="wrap">
      <div v-if="state !== 'ok'" class="banner small" :class="state">{{ error ? 'Agent unreachable — data may be old' : 'Data is stale' }}</div>
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
.short { display: none; }
.badge { margin-left: auto; background: var(--bad); color: #fff; border-radius: 999px; font-size: 10px; font-weight: 600; padding: 0 6px; line-height: 16px; }
.foot { margin-top: auto; padding: 0 10px; }
.banner { padding: 7px 12px; border-radius: 8px; margin-bottom: 14px; }
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
}

@media (max-width: 640px) {
  .shell { display: block; --tabbar: calc(58px + env(safe-area-inset-bottom)); }
  .side {
    position: fixed; z-index: 50; top: auto; bottom: 0; left: 0; right: 0; height: auto;
    padding: 0 4px env(safe-area-inset-bottom); flex-direction: row; gap: 0;
    border-right: 0; border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  }
  .brand, .foot { display: none; }
  nav { flex-direction: row; flex: 1; justify-content: space-around; gap: 0; }
  nav a { flex: 1; flex-direction: column; gap: 2px; padding: 8px 0 7px; font-size: 10px; border-radius: 0; background: none !important; }
  nav a.on { color: var(--accent); }
  .i { width: 21px; height: 21px; }
  nav a.on .i { color: var(--accent); }
  .l:not(.short) { display: none; }
  .short { display: block; }
  .l { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { position: absolute; top: 4px; left: calc(50% + 6px); padding: 0 4px; font-size: 9px; line-height: 14px; }
}
</style>
