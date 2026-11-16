/**
 * The open section of a page with <PageTabs>, kept in the URL (?s=<key> by default) so back/forward, reloads and
 * links land on it. The first tab is the default and stays out of the URL.
 * When it changes (click, back/forward) the page content under the tab row fades in with a 4px rise, for the stock row and
 * every skin's alike: WAAPI on the siblings after the row's wrapper, never on the sticky row itself. Not on first load,
 * not when the page itself changes, not with reduced motion.
 */
export function usePageTab(def: string, param = 's') {
  const route = useRoute()
  const tab = computed<string>({
    get: () => (typeof route.query[param] === 'string' && route.query[param] ? route.query[param] as string : def),
    set: v => { navigateTo({ query: { ...route.query, [param]: v === def ? undefined : v }, hash: '' }) },
  })
  if (import.meta.client) {
    const path = route.path
    let rise: Animation[] = []
    watch(tab, () => {
      if (route.path !== path || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      // every page-tab row, stock or skinned, is a <nav> holding a [role=tablist]; climb out of its wrappers (the stock one is display: contents) until something follows
      let el: HTMLElement | null = document.querySelector<HTMLElement>('nav:has([role=tablist])')
      for (let i = 0; el && !el.nextElementSibling && i < 4; i++) el = el.parentElement
      const css = getComputedStyle(document.documentElement) // the motion tokens stay the one source
      const duration = parseFloat(css.getPropertyValue('--dur')) || 180
      const easing = css.getPropertyValue('--ease-out').trim() || 'ease-out'
      rise.forEach(a => a.cancel())
      rise = []
      for (let n = el?.nextElementSibling; n; n = n.nextElementSibling) {
        if (!(n instanceof HTMLElement) || ['fixed', 'absolute'].includes(getComputedStyle(n).position)) continue
        rise.push(n.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing, fill: 'none' }))
      }
    }, { flush: 'post' })
  }
  return tab
}
