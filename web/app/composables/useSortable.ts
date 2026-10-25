/**
 * Drag to reorder with a pointer (mouse and touch): press the item's grip, move over another item of the same
 * group and it takes that place. Items carry `data-sort="<group>:<id>"`; the grip needs `touch-action: none`.
 * `onMove(group, ids)` gets the group's new order on every step, `onDone` once when the finger lifts.
 */
export function useSortable(order: (group: string) => string[], onMove: (group: string, ids: string[]) => void, onDone: () => void) {
  const dragging = ref('')
  /** `el`: the element that follows the pointer when the drag starts later than pointerdown (hold to drag) */
  function grab(e: PointerEvent, group: string, id: string, el?: HTMLElement) {
    e.preventDefault()
    const grip = el ?? e.currentTarget as HTMLElement
    grip.setPointerCapture?.(e.pointerId)
    dragging.value = `${group}:${id}`
    const move = (ev: PointerEvent) => {
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-sort]')?.dataset.sort
      if (!over || !over.startsWith(group + ':')) return
      const target = over.slice(group.length + 1)
      if (target === id) return
      const ids = order(group).filter(x => x !== id)
      const at = ids.indexOf(target)
      const from = order(group).indexOf(id)
      ids.splice(from <= at ? at + 1 : at, 0, id)
      onMove(group, ids)
    }
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
      dragging.value = ''
      onDone()
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  }
  return { grab, dragging }
}
