// Local PostCSS plugin: every :hover selector lives in `@media (hover: hover)`, so a tap on a phone never leaves a
// sticky hover state. Mixed selector lists are split (the non-hover selectors stay where they were); rules already
// inside a hover media query, and @keyframes, are left alone. Runs on core CSS, add-on layers and scoped SFC styles,
// so no file needs its own guard.
const HOVER = /:hover\b/
const guarded = (node) => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && /^(-\w+-)?keyframes$/i.test(p.name)) return true
    if (p.type === 'atrule' && p.name === 'media' && /\(\s*hover\s*:\s*hover\s*\)/i.test(p.params)) return true
  }
  return false
}
const plugin = () => ({
  postcssPlugin: 'bastion-hover-guard',
  Once(root, { AtRule }) {
    const rules = []
    root.walkRules((r) => { if (HOVER.test(r.selector) && !guarded(r)) rules.push(r) })
    for (const r of rules) {
      const sels = r.selectors
      const hov = sels.filter(s => HOVER.test(s))
      const rest = sels.filter(s => !HOVER.test(s))
      const media = new AtRule({ name: 'media', params: '(hover: hover)' })
      const h = r.clone({ selectors: hov })
      h.raws.before = ''
      media.append(h)
      r.after(media)
      if (rest.length) r.selectors = rest
      else r.remove()
    }
  },
})
plugin.postcss = true
export default plugin
