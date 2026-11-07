/**
 * a page the signed-in role may not open goes Home; a switched-off add-on's pages show a short message with a link to the Add-ons page
 * (runs after auth.global: global middleware go by file name)
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { list, off, load, pageOn, pageAllowed } = useAddons()
  if (to.path === '/login') return
  if (!pageAllowed(to.path)) return to.path === '/' ? undefined : navigateTo('/')
  if (!addonOf(list, to.path)) return
  if (off.value === null) await load()
  if (!pageOn(to.path)) return navigateTo({ path: '/addons', query: { off: to.path } })
})
