<script setup lang="ts">
const { data: o, error, updated, refresh } = useOverview()
usePoll(refresh, 5000)

const route = useRoute()
const nav = [
  { to: '/', icon: '🏠', label: 'Apps' },
  { to: '/media', icon: '🍿', label: 'Media' },
  { to: '/dev', icon: '⌨️', label: 'Dev' },
  { to: '/deals', icon: '🏷️', label: 'Deals' },
  { to: '/metrics', icon: '📊', label: 'Metrics' },
  { to: '/chat', icon: '✦', label: 'Chat' },
]
const problems = computed(() => alerts(o.value).filter(a => a.level === 'bad').length)

// theme: auto → dark → light
const theme = ref<'auto' | 'dark' | 'light'>('auto')
onMounted(() => { try { theme.value = (localStorage.getItem('theme') as any) || 'auto' } catch {} })
watchEffect(() => {
  if (import.meta.server) return
  if (theme.value === 'auto') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme.value)
  try { localStorage.setItem('theme', theme.value) } catch {}
})
const cycle = () => (theme.value = theme.value === 'auto' ? 'dark' : theme.value === 'dark' ? 'light' : 'auto')

const tick = ref(Date.now())
let t: any
onMounted(() => (t = setInterval(() => (tick.value = Date.now()), 1000)))
onUnmounted(() => clearInterval(t))
const stale = computed(() => updated.value > 0 && tick.value - updated.value > 20000)
</script>

<template>
  <div class="wrap">
    <header class="top">
      <NuxtLink to="/" class="brand">
        <span class="logo">🖥️</span>
        <div>
          <h1>pve</h1>
          <div class="muted small">{{ o?.cts?.filter((c: any) => c.status === 'running').length ?? '–' }} of {{ o?.cts?.length ?? '–' }} containers up</div>
        </div>
      </NuxtLink>

      <nav>
        <NuxtLink v-for="n in nav" :key="n.to" :to="n.to" :class="{ on: route.path === n.to }">
          <span class="i">{{ n.icon }}</span><span class="l">{{ n.label }}</span>
          <span v-if="n.to === '/metrics' && problems" class="badge">{{ problems }}</span>
        </NuxtLink>
      </nav>

      <div class="right small">
        <span v-if="error" class="pill bad">agent unreachable</span>
        <span v-else-if="stale" class="pill warn">stale</span>
        <span class="muted" :title="updated ? new Date(updated).toLocaleString() : ''"><span class="dot" :class="error ? 'bad' : stale ? 'warn' : 'ok'" /> live</span>
        <button class="btn ghost" :title="`theme: ${theme}`" @click="cycle">{{ theme === 'auto' ? '◐' : theme === 'dark' ? '☾' : '☀' }}</button>
      </div>
    </header>

    <slot />
  </div>
</template>

<style scoped>
.top { display: flex; align-items: center; gap: 20px; margin-bottom: 18px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 12px; color: var(--text); }
.brand:hover { text-decoration: none; }
.logo { font-size: 24px; width: 42px; height: 42px; display: grid; place-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
h1 { margin: 0; font-size: 20px; line-height: 1.1; }
nav { display: flex; gap: 4px; flex-wrap: wrap; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 4px; }
nav a { display: flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 7px; color: var(--muted); font-size: 13px; }
nav a:hover { color: var(--text); text-decoration: none; background: var(--panel-2); }
nav a.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.badge { background: var(--bad); color: #fff; border-radius: 999px; font-size: 10px; padding: 0 5px; line-height: 15px; }
.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.right .dot { width: 6px; height: 6px; margin-right: 4px; vertical-align: middle; }
@media (max-width: 760px) {
  .top { gap: 12px; }
  nav { width: 100%; order: 3; justify-content: space-between; }
  nav a { padding: 6px 9px; }
  nav .l { display: none; }
  nav .i { font-size: 15px; }
}
</style>
