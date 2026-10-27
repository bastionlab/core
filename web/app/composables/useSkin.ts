/**
 * Skins: a design (Designs add-on) may name a skin; an installed skin add-on brings `Skin<Name><Piece>.global.vue`
 * components, and the core pieces below render those instead of their own, with the same props and slots:
 * Nav (the layout's sidebar + phone tabs), Backdrop (full-page layer behind everything), Frame (wraps each page:
 * props path, title, icon + the page as its slot), Panel, Stat, TopicCard; page changes animate with CSS classes
 * .skin-<name>-enter-active etc. (app.vue). No skin, or a piece the skin lacks = the stock one. Contract: addons/designs/SKINS.md
 */
export const useSkin = () => useState<string>('skin', () => '')

export function useSkinned(piece: string) {
  const skin = useSkin()
  const app = getCurrentInstance()?.appContext
  return computed(() => {
    if (!skin.value || !app) return null
    const name = `Skin${skin.value.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase())}${piece}`
    return app.components[name] ?? null
  })
}
