/** ask the server once per page load whether the session is good and which role it has; a 401 later (cookie expired) goes through plugins/locked.ts */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const ok = useState('auth:ok', () => false)
  const role = useState<string | null>('auth:role', () => null)
  if (ok.value && role.value) return
  const s = await $fetch<{ ok: boolean, role: string | null }>('/api/auth/status').catch(() => ({ ok: false, role: null }))
  if (!s.ok) return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} })
  ok.value = true
  role.value = s.role ?? 'owner'
})
