/**
 * Keep an open app on the newest build. dash-live rebuilds the app a few seconds after every edit, but a tab or
 * the home-screen app keeps running the code it loaded. Every minute (and when the app comes back to the front)
 * this asks for the build id; when it changed, the next tab switch or return to the app is a full page load
 * instead — never mid-typing. Chat drafts live in localStorage, so nothing is lost.
 */
export default defineNuxtPlugin(() => {
  const mine = useRuntimeConfig().app.buildId
  let stale = false
  const check = async () => {
    if (stale || document.hidden) return
    try {
      const r = await fetch(`/_nuxt/builds/latest.json?t=${Date.now()}`, { cache: 'no-store' })
      if (r.ok) stale = (await r.json()).id !== mine
    } catch { /* offline or the app is restarting: try again later */ }
  }
  setInterval(check, 60_000)

  useRouter().beforeEach((to, from) => {
    if (stale && to.path !== from.path) {
      window.location.assign(to.fullPath)
      return false
    }
  })
  let away = 0
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { away = Date.now(); return }
    if (stale) return window.location.reload()
    // back after a while (phone unlocked, app reopened): look now rather than in a minute
    if (Date.now() - away > 5_000) {
      await check()
      if (stale) window.location.reload()
    }
  })
})
