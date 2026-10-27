/**
 * The open section of a page with <PageTabs>, kept in the URL (?s=<key> by default) so back/forward, reloads and
 * links land on it. The first tab is the default and stays out of the URL.
 */
export function usePageTab(def: string, param = 's') {
  const route = useRoute()
  return computed<string>({
    get: () => (typeof route.query[param] === 'string' && route.query[param] ? route.query[param] as string : def),
    set: v => { navigateTo({ query: { ...route.query, [param]: v === def ? undefined : v }, hash: '' }) },
  })
}
