/**
 * Shared behaviour of every page-tab row (stock PageTabs and the skins' Skin<Name>PageTabs): the strip scrolls sideways with
 * the open tab kept in view, edge fades, scroll-under-the-sticky-bar on pick, and an AUTOMATIC icon-only mode: with
 * autoCompact the nav gets class `is-compact` only when, on a phone, the row would overflow with every label showing.
 * The component puts ref="anchor" on a spacer before the nav, ref="strip" on the scroller and ref="nav" on the nav element
 * (the one that carries the state class), then hides closed tabs' labels under `.is-compact` in a phone media query.
 */
import type { Ref } from 'vue'

export function usePageTabs(opts: { count: () => number, model: Ref<string>, autoCompact?: boolean }) {
  const { model } = opts
  const anchor = ref<HTMLElement>()
  const strip = ref<HTMLElement>()
  const nav = ref<HTMLElement>()
  const edge = ref({ l: false, r: false })

  function measure() {
    const s = strip.value
    if (s) edge.value = { l: s.scrollLeft > 4, r: s.scrollLeft + s.clientWidth < s.scrollWidth - 4 }
  }
  function reveal(smooth = true) {
    const s = strip.value
    const b = s?.querySelector<HTMLElement>('.on')
    if (!s || !b) return
    const left = b.offsetLeft - (s.clientWidth - b.offsetWidth) / 2
    s.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' })
  }
  function pick(k: string) {
    if (k === model.value) return
    model.value = k
    // scrolled past the bar: bring the new section's start up under it instead of leaving you mid-page
    const a = anchor.value
    const stick = parseFloat(getComputedStyle(a?.nextElementSibling ?? document.body).top) || 0
    const y = a?.getBoundingClientRect().top ?? 0
    if (a && y < stick) window.scrollTo({ top: window.scrollY + y - stick })
  }
  // Vue rewrites the whole class attribute whenever the component's own class binding changes (edge fades, stuck…), which would
  // drop the class we add by hand: keep the wanted state and put it back at once (a microtask, before paint)
  let compact = false
  let mo: MutationObserver | undefined
  // measured with every label visible: class off, read, class back on in the same task so nothing flashes
  function fit() {
    const s = strip.value
    const n = nav.value
    if (!opts.autoCompact || !s || !n || typeof window === 'undefined') return
    compact = false
    n.classList.remove('is-compact')
    if (window.matchMedia('(max-width: 640px)').matches && s.scrollWidth > s.clientWidth + 1) { compact = true; n.classList.add('is-compact') }
    if (!mo && typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => { if (compact && !n.classList.contains('is-compact')) n.classList.add('is-compact') })
      mo.observe(n, { attributes: true, attributeFilter: ['class'] })
    }
  }
  const onResize = () => { fit(); measure() }

  watch(model, () => nextTick(() => reveal()))
  onMounted(() => {
    nextTick(() => { reveal(false); measure(); fit() })
    window.addEventListener('resize', onResize)
  })
  onBeforeUnmount(() => { mo?.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', onResize) })
  watch(opts.count, () => nextTick(() => { measure(); fit() }))

  return { anchor, strip, nav, edge, measure, reveal, pick, fit }
}
