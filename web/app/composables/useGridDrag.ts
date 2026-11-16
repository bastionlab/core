/**
 * Drag-to-reorder for Home's one tile grid (pointer events, mouse + touch). HomeItem decides when a press turns into
 * a drag (mouse: 5px, touch: hold) and calls `start`; from there this owns the gesture:
 *  - a ghost clone follows the pointer, the real tile stays in the grid as the placeholder (`dragKey` → `.ph`)
 *  - the tile under the pointer decides the new place (before/after it), with hysteresis so tiles don't jitter
 *  - every reorder is FLIP-animated, the page auto-scrolls near the viewport edges
 *  - release = animate the ghost into the placeholder and commit; Escape / pointercancel = restore the old order
 * `keys` is the order on screen now, `draft(keys | null)` shows an order without saving (null = back to saved).
 */
export function useGridDrag(o: {
  board: Ref<HTMLElement | undefined>
  keys: () => string[]
  draft: (keys: string[] | null) => void
  commit: (keys: string[]) => void
}) {
  const dragKey = ref('')
  const EASE = 'var(--ease-out, cubic-bezier(.2, .8, .2, 1))'
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const tiles = () => Array.from(o.board.value?.querySelectorAll<HTMLElement>(':scope > [data-key]') ?? [])
  const timers = new WeakMap<HTMLElement, number>()

  /** run `apply` (changes the order) and slide every tile that moved from where it was to where it is now */
  async function flip(apply: () => void) {
    const els = tiles()
    // where each tile is on screen right now (a tile still mid-slide continues from there)
    const first = new Map(els.map(t => [t.dataset.key!, t.getBoundingClientRect()]))
    for (const t of els) { clearTimeout(timers.get(t)); t.style.transition = 'none'; t.style.transform = '' }
    apply()
    await nextTick()
    window.dispatchEvent(new Event('home:layout'))
    if (reduced()) { for (const t of tiles()) t.style.transition = ''; return }
    const moved: HTMLElement[] = []
    for (const t of tiles()) {
      const a = first.get(t.dataset.key!)
      const b = t.getBoundingClientRect()
      if (!a || (Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1)) { t.style.transition = ''; continue }
      t.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`
      moved.push(t)
    }
    void o.board.value?.offsetWidth // commit the start positions
    for (const t of moved) {
      t.style.transition = `transform 180ms ${EASE}`
      t.style.transform = ''
      timers.set(t, window.setTimeout(() => { t.style.transition = '' }, 220))
    }
  }

  let stop: (() => void) | null = null
  let teardown: (() => void) | null = null // full cleanup (listeners, rAF, ghost, pending drop), used on unmount
  let dropping = false // the drop animation is running; its commit is still pending

  function start(e: PointerEvent, key: string, tile: HTMLElement) {
    if (stop || dropping) return
    const board = o.board.value
    if (!board) return
    const r0 = tile.getBoundingClientRect()
    const ghost = tile.cloneNode(true) as HTMLElement
    ghost.classList.remove('sel', 'editing')
    ghost.querySelectorAll(':scope > .ctl, .box > button.hd').forEach(n => n.remove())
    ghost.removeAttribute('data-key')
    Object.assign(ghost.style, {
      position: 'fixed', left: `${r0.left}px`, top: `${r0.top}px`, width: `${r0.width}px`, height: `${r0.height}px`,
      margin: '0', zIndex: '1000', pointerEvents: 'none', gridColumn: 'auto', gridRow: 'auto', transform: '', transition: 'none',
      willChange: 'transform',
    })
    const gbox = ghost.firstElementChild as HTMLElement | null
    if (gbox) gbox.style.boxShadow = '0 10px 28px rgb(0 0 0 / .35)'
    document.body.appendChild(ghost)
    navigator.vibrate?.(10)

    const off = { x: e.clientX - r0.left, y: e.clientY - r0.top }
    const pt = { x: e.clientX, y: e.clientY }
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;visibility:hidden;height:var(--tabbar, 0px)'
    document.body.appendChild(probe)
    const tabbar = probe.offsetHeight
    probe.remove()
    let last: { x: number, y: number } | null = null
    let lastSig = ''
    let raf = 0
    let dropTimer = 0
    const startKeys = o.keys()
    dragKey.value = key

    const retarget = (force: boolean) => {
      const el = document.elementFromPoint(pt.x, pt.y)
      if (!el || !board.contains(el)) return
      const keys = o.keys()
      const hit = (el.closest('[data-key]') as HTMLElement | null)
      let next: string[]
      let sig: string
      if (hit && board.contains(hit)) {
        const tk = hit.dataset.key!
        if (tk === key) return
        const r = hit.getBoundingClientRect()
        const ph = tiles().find(t => t.dataset.key === key)?.getBoundingClientRect()
        const otherRow = !!ph && Math.abs(r.top - ph.top) > 4
        const before = hit.dataset.w === '1' && otherRow ? pt.y < r.top + r.height / 3 : pt.x < r.left + r.width / 2
        next = keys.filter(k => k !== key)
        const i = next.indexOf(tk)
        next.splice(before ? i : i + 1, 0, key)
        sig = `${tk}:${before ? 'b' : 'a'}`
      } else {
        const lastTile = tiles().filter(t => t.dataset.key !== key).pop()
        if (lastTile && pt.y <= lastTile.getBoundingClientRect().bottom) return
        next = [...keys.filter(k => k !== key), key]
        sig = 'end'
      }
      if (next.join() === keys.join() || sig === lastSig) return
      if (!force && last && Math.hypot(pt.x - last.x, pt.y - last.y) < 16) return
      lastSig = sig
      last = { x: pt.x, y: pt.y }
      flip(() => o.draft(next))
    }

    const tick = () => {
      ghost.style.transform = `translate3d(${pt.x - off.x - r0.left}px, ${pt.y - off.y - r0.top}px, 0) scale(1.03)`
      const edge = 80
      const top = pt.y, bottom = window.innerHeight - tabbar - pt.y
      const v = top < edge ? -(edge - top) / edge : bottom < edge ? (edge - bottom) / edge : 0
      if (v) {
        const before = window.scrollY
        window.scrollBy(0, Math.round(v * 18))
        if (window.scrollY !== before) retarget(true)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const move = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return
      if (m.pointerType === 'mouse' && m.buttons === 0) { finish(false); return } // released outside the window
      pt.x = m.clientX; pt.y = m.clientY
      retarget(false)
    }
    const finish = (cancel: boolean) => {
      stop?.()
      stop = null
      cancelAnimationFrame(raf)
      if (cancel) {
        flip(() => o.draft(null))
        ghost.remove()
        dragKey.value = ''
        teardown = null
        return
      }
      const keys = o.keys()
      dropping = true
      const ph = tiles().find(t => t.dataset.key === key)?.getBoundingClientRect() ?? r0
      ghost.style.transition = reduced() ? 'none' : `transform 150ms ${EASE}`
      ghost.style.transform = `translate3d(${ph.left - r0.left}px, ${ph.top - r0.top}px, 0) scale(1)`
      if (gbox) gbox.style.boxShadow = ''
      dropTimer = window.setTimeout(() => {
        ghost.remove(); dragKey.value = ''; dropping = false; teardown = null
        // an unchanged order is no edit: just drop the draft
        if (keys.join() !== startKeys.join()) o.commit(keys); else o.draft(null)
      }, reduced() ? 0 : 150)
    }
    const up = (u: PointerEvent) => { if (u.pointerId === e.pointerId) finish(false) }
    const cancel = (u: PointerEvent) => { if (u.pointerId === e.pointerId) finish(true) }
    const esc = (k: KeyboardEvent) => { if (k.key === 'Escape') finish(true) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', esc)
    stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', esc)
    }
    teardown = () => {
      stop?.(); stop = null
      cancelAnimationFrame(raf)
      clearTimeout(dropTimer)
      ghost.remove()
      dropping = false
      teardown = null
    }
    ghost.style.transform = `translate3d(0, 0, 0) scale(1.03)`
  }

  if (getCurrentInstance()) onBeforeUnmount(() => teardown?.())
  return { dragKey, start, flip }
}
