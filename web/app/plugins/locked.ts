/** any API call that comes back 401 means the session ended (browser kept the tab, cookie expired): back to the PIN */
export default defineNuxtPlugin(() => {
  const go = () => {
    if (location.pathname === '/login') return
    useState('auth:ok').value = false
    useState('auth:role').value = null
    navigateTo({ path: '/login', query: { next: location.pathname + location.search } })
  }
  const orig = window.fetch
  window.fetch = async (...args) => {
    const res = await orig(...args)
    const url = String(args[0] instanceof Request ? args[0].url : args[0])
    if (res.status === 401 && /^(\/|https?:\/\/[^/]*\/)api\//.test(url.replace(location.origin, '')) && !url.includes('/api/auth/')) go()
    return res
  }
  // $fetch keeps its own fetch reference, so it needs the hook too
  globalThis.$fetch = $fetch.create({
    onResponseError({ request, response }) {
      if (response.status === 401 && !String(request).includes('/api/auth/')) go()
    },
  }) as typeof $fetch
})
