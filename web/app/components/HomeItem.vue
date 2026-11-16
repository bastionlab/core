<script setup lang="ts">
/**
 * one app tile or section card on Home. It spans `w` grid columns and `h` rows. In edit mode it works like
 * phone home-screen widgets: hold (touch) or drag (mouse) the tile to move it, tap it to select it, then pull a
 * side of its frame to resize it in whole cells; the selected tile also gets a bar to pick a size, move it one place or hide it.
 */
const props = defineProps<{ it: { id: string, key: string, s?: any, comp?: string }, editing: boolean, selected: boolean, hidden: boolean, drag: boolean, box: { w: number, h: number }, chips?: any[], more?: any[], stat?: any, bars?: any[] }>()
const emit = defineEmits<{ grab: [PointerEvent, HTMLElement], select: [], hide: [], move: [number], resize: [{ w: number, h: number }], resized: [] }>()

const MAX_H = 4
const HOLD_MS = 250
const PRESETS = [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }, { w: 4, h: 1 }, { w: 4, h: 2 }]
const el = ref<HTMLElement>()
// the grid's column count changes with the screen: a box wider than the grid just fills it
const cols = ref(10)
const measure = () => {
  const g = el.value?.parentElement
  if (g) cols.value = getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length || cols.value
}
// once a hold has turned into a drag the page must not scroll under the finger
let lifted = false
const noScroll = (e: TouchEvent) => { if (lifted) e.preventDefault() }
watch(() => props.drag, d => { if (!d) lifted = false })
// the control bar stays inside the viewport: shifted sideways when the tile sits at an edge
const ctl = ref<HTMLElement>()
const shift = ref(0)
function fit() {
  const c = ctl.value
  if (!c) return
  const r = c.getBoundingClientRect(), m = 8
  const l = r.left - shift.value, rt = r.right - shift.value
  shift.value = l < m ? m - l : rt > window.innerWidth - m ? window.innerWidth - m - rt : 0
}
const relayout = () => { measure(); fit() }
onMounted(() => {
  measure()
  window.addEventListener('resize', relayout)
  window.addEventListener('home:layout', relayout)
  el.value?.addEventListener('touchmove', noScroll, { passive: false })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', relayout)
  window.removeEventListener('home:layout', relayout)
  el.value?.removeEventListener('touchmove', noScroll)
})
const w = computed(() => Math.min(props.box.w, cols.value))
const h = computed(() => props.box.h)
watch([() => props.selected, () => props.editing, w, h], () => nextTick(fit))
const isPreset = (p: { w: number, h: number }) => w.value === Math.min(p.w, cols.value) && h.value === p.h
const preset = (p: { w: number, h: number }) => { emit('resize', { w: Math.min(p.w, cols.value), h: p.h }); emit('resized') }

// what the content shows: 1 column = icon + name, 2+ rows = detail rows, else the normal card.
// AppTile, TopicCard and add-on cards read it.
provide('homeSize', computed(() => (w.value <= 1 ? 's' : h.value >= 2 ? 'l' : 'm')))
provide('homeBox', computed(() => ({ w: w.value, h: h.value })))

// press on the tile: a tap selects it; touch = hold still to pick it up (moving first scrolls the page),
// mouse = start moving
function press(e: PointerEvent) {
  if (!props.editing || e.button > 0 || (e.target as HTMLElement).closest('button')) return
  const t = el.value!
  const x0 = e.clientX, y0 = e.clientY
  const touch = e.pointerType !== 'mouse'
  let timer = 0
  const end = () => {
    clearTimeout(timer)
    t.removeEventListener('pointermove', move)
    t.removeEventListener('pointerup', tap)
    t.removeEventListener('pointercancel', end)
  }
  const lift = (ev: PointerEvent) => {
    end()
    lifted = true
    navigator.vibrate?.(12)
    // the tile may move (reorder) and lose the pointer capture: listen on window, not on the tile
    const drop = (u: PointerEvent) => {
      if (u.pointerId !== ev.pointerId) return
      lifted = false
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', drop)
    }
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', drop)
    emit('grab', ev, t)
  }
  const move = (m: PointerEvent) => {
    if (Math.hypot(m.clientX - x0, m.clientY - y0) < (touch ? 8 : 5)) return
    if (touch) end()
    else lift(m)
  }
  const tap = () => { end(); emit('select') }
  t.addEventListener('pointermove', move)
  t.addEventListener('pointerup', tap)
  t.addEventListener('pointercancel', end)
  if (touch) timer = window.setTimeout(() => lift(e), HOLD_MS)
}

// a side handle: pointer travel → whole columns/rows, live while dragging, saved on release.
// Left/top grow the other way; the grid's flow decides where the tile sits.
function resize(e: PointerEvent, side: 'l' | 'r' | 't' | 'b') {
  const g = el.value?.parentElement
  if (!g) return
  e.preventDefault()
  e.stopPropagation()
  measure()
  const cs = getComputedStyle(g)
  const gap = parseFloat(cs.columnGap) || 10
  const colStep = (g.clientWidth + gap) / cols.value
  const rowStep = (parseFloat(cs.getPropertyValue('--row')) || 64) + (parseFloat(cs.rowGap) || gap)
  const sx = side === 'r' ? 1 : side === 'l' ? -1 : 0
  const sy = side === 'b' ? 1 : side === 't' ? -1 : 0
  const x0 = e.clientX, y0 = e.clientY, w0 = w.value, h0 = h.value
  const t = e.currentTarget as HTMLElement
  t.setPointerCapture(e.pointerId)
  const move = (m: PointerEvent) => {
    const nw = Math.max(1, Math.min(cols.value, Math.round(w0 + sx * (m.clientX - x0) / colStep)))
    const nh = Math.max(1, Math.min(MAX_H, Math.round(h0 + sy * (m.clientY - y0) / rowStep)))
    if (nw !== w.value || nh !== h.value) emit('resize', { w: nw, h: nh })
  }
  const up = () => {
    t.removeEventListener('pointermove', move)
    t.removeEventListener('pointerup', up)
    t.removeEventListener('pointercancel', up)
    emit('resized')
  }
  t.addEventListener('pointermove', move)
  t.addEventListener('pointerup', up)
  t.addEventListener('pointercancel', up)
}
</script>

<template>
  <div
    ref="el" class="it" :class="{ editing, sel: editing && selected, hid: hidden, ph: drag }" :data-key="it.key" :data-w="w"
    :style="{ gridColumn: `span ${w}`, gridRow: `span ${h}` }"
    @pointerdown="press" @contextmenu="editing && $event.preventDefault()"
  >
    <div class="box">
      <AppTile v-if="it.s" :s="it.s" :inert="editing" />
      <component :is="it.comp" v-else-if="it.comp" />
      <TopicCard v-else to="/metrics" icon="metrics" name="Metrics" sub="Host, GPU, backups" :chips="chips" :more="more" :stat="stat" :bars="bars" />
      <template v-if="editing && selected">
        <button v-for="s in (['l', 'r', 't', 'b'] as const)" :key="s" type="button" class="hd" :class="s" :aria-label="$t('home.size')" @pointerdown="resize($event, s)" />
      </template>
    </div>
    <div v-if="editing && selected" ref="ctl" class="ctl" :style="{ translate: `calc(-50% + ${shift}px) 0` }" @pointerdown.stop>
      <span v-if="!PRESETS.some(isPreset)" class="mono sz">{{ w }}×{{ h }}</span>
      <button v-for="p in PRESETS" :key="`${p.w}${p.h}`" type="button" class="pre" :class="{ on: isPreset(p) }" @click="preset(p)">{{ p.w }}×{{ p.h }}</button>
      <span class="sep" />
      <button type="button" :aria-label="$t('home.moveEarlier')" @click="emit('move', -1)"><Icon name="chevron-left" :size="15" /></button>
      <button type="button" :aria-label="$t('home.moveLater')" @click="emit('move', 1)"><Icon name="chevron-right" :size="15" /></button>
      <button type="button" :class="{ on: hidden }" :aria-label="hidden ? 'Show' : 'Hide'" @click="emit('hide')"><Icon name="eyeoff" :size="15" /></button>
    </div>
  </div>
</template>

<style scoped>
.it { position: relative; min-width: 0; display: flex; flex-direction: column; }
/* a size container: the cards inside lay themselves out by the tile's own width and height (@container tile) */
.box { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; border-radius: var(--radius); container: tile / size; }
.box > :first-child { flex: 1; min-height: 0; }
/* edit mode: the tile is something to hold and move, not a link */
.it.editing { cursor: grab; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.it.editing .box > :first-child { pointer-events: none; }
.it.editing:not(.sel) .box { outline: 1.5px dashed var(--line-2); outline-offset: 2px; }
.it.hid .box > :first-child { opacity: .3; }
.it.sel { z-index: 3; }
/* the tile being dragged: its ghost follows the pointer (useGridDrag), this one marks the free place */
.it.editing.ph .box { outline: 1.5px dashed var(--accent); outline-offset: 0; background: var(--accent-soft); }
.it.ph .box > * { visibility: hidden; }
.it.ph .ctl { display: none; }
/* the selected tile: a frame with a handle in the middle of each side */
.it.sel .box { outline: 2px solid var(--accent); outline-offset: 2px; }
.hd {
  position: absolute; z-index: 2; width: 14px; height: 14px; padding: 0; border: 2px solid var(--accent); border-radius: 50%;
  background: var(--panel); touch-action: none;
}
.hd::after { content: ''; position: absolute; inset: -10px; } /* a bigger target than the dot */
.hd.l { left: -9px; top: 50%; translate: 0 -50%; cursor: ew-resize; }
.hd.r { right: -9px; top: 50%; translate: 0 -50%; cursor: ew-resize; }
.hd.t { top: -9px; left: 50%; translate: -50% 0; cursor: ns-resize; }
.hd.b { bottom: -9px; left: 50%; translate: -50% 0; cursor: ns-resize; }
.ctl {
  position: absolute; top: calc(100% + 10px); left: 50%; translate: -50% 0; z-index: 4; white-space: nowrap; max-width: calc(100vw - 16px);
  display: flex; align-items: center; gap: 2px; padding: 2px 2px 2px 8px;
  background: var(--panel-2); border: 1px solid var(--line-2); border-radius: 999px; box-shadow: 0 2px 8px rgb(0 0 0 / .4);
}
.ctl .sz { font-size: 11px; color: var(--accent); margin-right: 2px; }
.ctl button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%; background: none; color: var(--muted); cursor: pointer; }
.ctl .sep { width: 1px; height: 16px; margin: 0 4px; background: var(--line-2); flex: none; }
.ctl button.pre { width: auto; padding: 0 8px; border-radius: 999px; font-size: 11px; font-variant-numeric: tabular-nums; }
.ctl button.on { color: var(--accent); background: var(--accent-soft); }
@media (pointer: coarse) {
  .ctl button { width: 32px; height: 32px; }
  .ctl button.pre { width: auto; padding: 0 6px; }
  .hd { width: 18px; height: 18px; }
  .hd.l { left: -11px; } .hd.r { right: -11px; } .hd.t { top: -11px; } .hd.b { bottom: -11px; }
}
</style>
