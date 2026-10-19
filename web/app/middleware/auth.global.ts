/** ask the server once per page load whether the PIN cookie is good; a 401 later (cookie expired) goes through plugins/locked.ts */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const ok = useState('auth:ok', () => false)
  if (ok.value) return
  const s = await $fetch<{ ok: boolean }>('/api/auth/status').catch(() => ({ ok: false }))
  if (!s.ok) return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} })
  ok.value = true
})
