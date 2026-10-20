<script setup lang="ts">
/** Read-only mirror of a tmux pane. Draws `capture-pane -e` output with xterm.js at the pane's real width,
 *  so full-width TUIs (Claude Code, the conductor) look like they do in tmux instead of re-wrapping into a mess.
 *  The font shrinks to fit the width down to MIN_FONT; past that the mirror scrolls sideways. */
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ snap: { log: string, cols: number, rows: number } | null }>()
const MIN_FONT = 8
const MAX_FONT = 12.5

const wrap = ref<HTMLElement>()
const host = ref<HTMLElement>()
let term: any
let last = ''
let ratio = 0.6 // monospace advance / font size, measured once
let size = { font: 0, cols: 0, rows: 0 }
let cellH = 0 // real cell height at size.font, read back from xterm after a resize
let mounted = true

let font = 'monospace'

function measure() {
  const c = document.createElement('canvas').getContext('2d')
  if (!c) return
  c.font = `100px ${font}`
  ratio = c.measureText('M'.repeat(10)).width / 1000 || ratio
}

async function draw(force = false) {
  const s = props.snap
  if (!s?.cols || !wrap.value || !host.value) return
  if (!term) {
    const [{ Terminal }, { Unicode11Addon }, f] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-unicode11'), termFont()])
    if (!mounted || term) return
    font = f
    measure()
    term = new Terminal({
      disableStdin: true, cursorBlink: false, cursorInactiveStyle: 'none', scrollback: 1000,
      fontFamily: font, fontSize: MAX_FONT, lineHeight: 1, cols: s.cols, rows: 10,
      theme: { background: '#07080b', foreground: '#d5d9e0', cursor: '#07080b' }, allowProposedApi: true,
    })
    term.loadAddon(new Unicode11Addon()) // emoji are two cells wide, as in tmux (see TermFull)
    term.unicode.activeVersion = '11'
    term.open(host.value)
    force = true
  }
  const w = wrap.value.clientWidth - 16
  const h = wrap.value.clientHeight - 12
  const fs = Math.max(MIN_FONT, Math.min(MAX_FONT, Math.floor((w / (s.cols * ratio)) * 2) / 2))
  if (fs !== size.font) cellH = 0
  let rows = Math.max(3, Math.floor(h / (cellH || fs * 1.25)))
  const resized = fs !== size.font || s.cols !== size.cols || rows !== size.rows
  if (resized) {
    term.options.fontSize = fs
    term.resize(s.cols, rows)
    size = { font: fs, cols: s.cols, rows }
    const screen = host.value.querySelector('.xterm-screen') as HTMLElement | null
    if (screen?.offsetHeight) {
      cellH = screen.offsetHeight / rows
      const fit = Math.max(3, Math.floor(h / cellH))
      if (fit !== rows) { term.resize(s.cols, fit); size.rows = fit }
    }
  }
  if (s.log === last && !resized && !force) return
  // the owner scrolled up to read — don't yank them back down until they return to the bottom
  const b = term.buffer.active
  if (last && b.viewportY < b.baseY && !resized) return
  last = s.log
  term.reset()
  term.write(s.log.replace(/\r?\n/g, '\r\n') + '\x1b[?25l')
}

watch(() => props.snap, () => draw())
let ro: ResizeObserver | undefined
onMounted(() => { draw(); ro = new ResizeObserver(() => draw(true)); ro.observe(wrap.value!) })
onBeforeUnmount(() => { mounted = false; ro?.disconnect(); term?.dispose() })
</script>

<template>
  <div ref="wrap" class="mirror">
    <div ref="host" class="xt" />
  </div>
</template>

<style scoped>
.mirror { height: 100%; overflow-x: auto; overflow-y: hidden; padding: 6px 8px; background: #07080b; }
.xt { width: max-content; }
.xt :deep(.xterm-viewport) { background: #07080b !important; }
</style>
