/**
 * Pull-to-refresh on phones: drag down from the top of the page and let go past the mark. Re-runs everything the
 * page polls (usePoll) plus its useFetch data; the page stays on screen, dimmed, until the new data is in.
 * Not on pages that scroll inside themselves (chat, terminals), anything marked `data-no-pull` or with touch-action: none.
 */
export function usePull(skip: () => boolean) {
  const dist = ref(0)
  const busy = ref(false)
  const MARK = 64
  let y0 = -1
  const scrolled = (el: Element | null) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      // touch-action: none = a drawing surface (kanji pad…) that owns the drag
      if ((e as HTMLElement).dataset?.noPull !== undefined || e.scrollTop > 0 || getComputedStyle(e).touchAction === 'none') return true
    }
    return false
  }
  function start(e: TouchEvent) {
    y0 = -1
    if (busy.value || skip() || window.scrollY > 0 || e.touches.length !== 1 || scrolled(e.target as Element)) return
    y0 = e.touches[0]!.clientY
  }
  function move(e: TouchEvent) {
    if (y0 < 0) return
    const dy = e.touches[0]!.clientY - y0
    dist.value = dy > 0 && window.scrollY <= 0 ? Math.min(110, dy * 0.5) : 0
  }
  async function end() {
    if (y0 < 0) return
    y0 = -1
    if (dist.value < MARK) { dist.value = 0; return }
    busy.value = true
    dist.value = MARK
    try { await Promise.allSettled([...[...pageRefreshers].map(f => f()), refreshNuxtData()]) } finally { busy.value = false; dist.value = 0 }
  }
  onMounted(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    window.addEventListener('touchstart', start, { passive: true })
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', end)
    window.addEventListener('touchcancel', end)
  })
  onUnmounted(() => {
    window.removeEventListener('touchstart', start)
    window.removeEventListener('touchmove', move)
    window.removeEventListener('touchend', end)
    window.removeEventListener('touchcancel', end)
  })
  return { dist, busy, ready: computed(() => dist.value >= MARK) }
}
