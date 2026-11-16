/**
 * Tell an open app when a newer build exists. dash-live rebuilds the app a few seconds after every edit, but a tab or
 * the home-screen app keeps running the code it loaded. Every minute (and when the app comes back to the front)
 * this asks for the build id; when it changed, `newBuild` turns on and the layout shows a "Reload" bar. Nothing
 * reloads by itself, so nobody is cut off mid-typing.
 */
export default defineNuxtPlugin(() => {
  const mine = useRuntimeConfig().app.buildId
  const newBuild = useState<boolean>('newBuild', () => false)
  let stale = false
  const check = async () => {
    if (stale || document.hidden) return
    try {
      const r = await fetch(`/_nuxt/builds/latest.json?t=${Date.now()}`, { cache: 'no-store' })
      if (r.ok) stale = newBuild.value = (await r.json()).id !== mine
    } catch { /* offline or the app is restarting: try again later */ }
  }
  setInterval(check, 60_000)

  let away = 0
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { away = Date.now(); return }
    if (stale) return
    // back after a while (phone unlocked, app reopened): look now rather than in a minute
    if (Date.now() - away > 5_000) {
      await check()
    }
  })
})
