/** ask the server once per page load whether the session is good and which role it has; a 401 later (cookie expired) goes through plugins/locked.ts */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const ok = useState('auth:ok', () => false)
  const role = useState<string | null>('auth:role', () => null)
  if (ok.value && role.value) return
  const s: any = await $fetch<{ ok: boolean, role: string | null }>('/api/auth/status').catch(e => (e?.data?.offline ? 'offline' : { ok: false, role: null }))
  if (s === 'offline') return // no connection and no cached answer: open the app, the state is checked again once online
  if (!s.ok) return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} })
  ok.value = true
  role.value = s.role ?? 'owner'
  // a fresh install (no account yet, setup never finished) goes to the wizard once
  if (!s.accounts && to.path !== '/setup' && !import.meta.server) {
    const st: any = await $fetch('/api/setup').catch(() => null)
    if (st && !st.accounts && !st.done) return navigateTo('/setup')
  }
})
