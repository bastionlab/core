/**
 * Every tab beyond the core (Home, Metrics, Add-ons) is an add-on: addons/<id>/ with an addon.yaml and a Nuxt layer.
 * They reach the app through runtimeConfig.public.addons; switched-off ones drop out of the nav, the home page and
 * their routes (their CTs keep running).
 */
export interface Addon {
  id: string
  name: string
  icon: string
  /** addon.yaml only: installed version, compared against the marketplace index */
  version?: string
  /** addon.yaml only: position among the add-on tabs (lower = earlier) */
  order?: number
  /** pages that belong to it; none = a backend others build on (local AI) */
  routes: string[]
  author: string
  /** addon.yaml only: SPDX id of the add-on's own license (the core is AGPL-3.0; add-ons pick their own) */
  license?: string
  /** addon.yaml only: shown before install and on its card, e.g. it scrapes a site whose terms forbid that */
  warning?: string
  /** one or two lines: what it does for you */
  desc: string
  /** what the box needs to run it */
  needs: string[]
  /** addon.yaml only: shorter name for the tab, if `name` is too long for it */
  label?: string
  /** addon.yaml only: API path listing its outside connections ({ id, name, ok, warn, detail, fix }[]) for /settings */
  connections?: string
  /** addon.yaml only: brings a Settings<Id>.global.vue section for /settings */
  settingsUi?: boolean
  /** addon.yaml only: brings a Home<Id>.global.vue card for the home page */
  home?: boolean
  /** config.json `cts` key of the container it lives in */
  ct?: string
  dependsOn?: string[]
  /** addon.yaml `roles: { view, use }` — see shared/utils/roles.ts; missing = owner only */
  roles?: { view?: string, use?: string }
  /** addon.yaml `admin_actions:` — its actions an admin may run */
  adminActions?: string[]
  /** its API prefixes (/api/<name>), filled in at build time */
  api?: string[]
  /** addon.yaml only: its entries in the command palette (⌘K) */
  palette?: PaletteEntry[]
}

/** addon.yaml `palette:` — a page to open (`to`) or an action to confirm and run (`action` + `args`) */
export interface PaletteEntry { label: string, to?: string, action?: string, args?: Record<string, any>, icon?: string, keywords?: string }

export const CORE_PAGES = ['/', '/metrics', '/addons', '/settings', '/login']

/** add-ons still built into the core: none any more, every tab is an addons/<id>/ folder */
export const ADDONS: Addon[] = []

/** the add-on a page belongs to, if any */
export const addonOf = (list: Addon[], path: string) => list.find(a => a.routes.some(r => path === r || path.startsWith(r + '/')))
