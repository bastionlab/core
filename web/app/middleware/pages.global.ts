/** a switched-off add-on's pages send you to the Add-ons page (runs after auth.global: global middleware go by file name) */
export default defineNuxtRouteMiddleware(async (to) => {
  const { list, off, load, pageOn } = useAddons()
  if (to.path === '/login' || !addonOf(list, to.path)) return
  if (off.value === null) await load()
  if (!pageOn(to.path)) return navigateTo('/addons')
})
