<script setup lang="ts">
/** Full-screen terminal: a real `tmux attach` held open by the agent, rendered with xterm.js.
 *  Keystrokes go straight to the pty; closing only detaches (the session keeps running). */
import '@xterm/xterm/css/xterm.css'

// target shell = a fresh login shell (ShellsPanel); `session` names it, there is no project path
const props = defineProps<{ vmid: number, path?: string, target: 'preview' | 'cc' | 'ship' | 'shell', session?: string, title: string }>()
const emit = defineEmits<{ close: [] }>()

const host = ref<HTMLElement>()
const status = ref('connecting…')
const height = ref('100dvh')

let term: any, fit: any, es: EventSource | undefined, ro: ResizeObserver | undefined
let id = ''
let pos = 0
let closed = false
let size = { cols: 0, rows: 0 }

const post = (action: string, body: any) => $fetch(`/api/term/${action}`, { method: 'POST', body })

// keystrokes are posted in order, batched while one request is in flight
let pending = ''
let sending = false
async function flush() {
  if (sending || !pending || !id) return
  sending = true
  const data = pending
  pending = ''
  try { await post('input', { id, data }) } catch (e: any) { status.value = e?.data?.statusMessage || 'input failed' }
  sending = false
  if (pending) flush()
}
function type(data: string) { pending += data; flush() }

function connect() {
  es = new EventSource(`/api/term/stream?id=${encodeURIComponent(id)}&from=${pos}`)
  es.onmessage = (e) => {
    pos = Number(e.lastEventId) || pos
    const bin = atob(e.data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    term.write(bytes)
    status.value = ''
  }
  es.addEventListener('end', () => { status.value = 'session ended'; es?.close() })
  es.onerror = () => {
    es?.close()
    if (closed || status.value === 'session ended') return
    status.value = 'reconnecting…'
    setTimeout(() => !closed && connect(), 1000)
  }
}

let resizeTimer: any
function refit() {
  const vv = window.visualViewport
  if (vv) height.value = `${vv.height}px` // keep above the phone keyboard
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (!fit) return
    fit.fit()
    if (id && (term.cols !== size.cols || term.rows !== size.rows)) {
      size = { cols: term.cols, rows: term.rows }
      post('resize', { id, ...size }).catch(() => {})
    }
  }, 120)
}

onMounted(async () => {
  const [{ Terminal }, { FitAddon }, { Unicode11Addon }] = await Promise.all([
    import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-unicode11')])
  const phone = window.innerWidth < 640
  term = new Terminal({
    cursorBlink: true, fontSize: phone ? 12 : 13, scrollback: 2000, allowProposedApi: true,
    fontFamily: await termFont(),
    theme: { background: '#0a0c0f', foreground: '#d5d9e0' },
  })
  // tmux counts emoji like Claude Code's 🟡 / 🟢 as two cells; xterm's default (Unicode 6) as one, which shifted the
  // rest of that line by a cell
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value!)
  // WebGL paints all backgrounds before the text, so a Nerd Font icon may spill into the next cell like in a
  // real terminal; the default DOM renderer lets the neighbour's background cut it in half
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl')
    const gl = new WebglAddon()
    gl.onContextLoss(() => gl.dispose())
    term.loadAddon(gl)
  } catch {}
  fit.fit()
  size = { cols: term.cols, rows: term.rows }
  term.onData(type)
  term.focus()
  try {
    const r: any = await post('open', { vmid: props.vmid, path: props.path, target: props.target, session: props.session, ...size })
    id = r.id
    connect()
    term.focus()
  } catch (e: any) {
    status.value = e?.data?.statusMessage || e?.message || 'could not attach'
  }
  ro = new ResizeObserver(refit)
  ro.observe(host.value!)
  window.visualViewport?.addEventListener('resize', refit)
  refit()
})

function close() {
  if (closed) return
  closed = true
  es?.close()
  if (id) post('close', { id }).catch(() => {})
  emit('close')
}
onBeforeUnmount(() => {
  ro?.disconnect()
  window.visualViewport?.removeEventListener('resize', refit)
  close()
  term?.dispose()
})

// keys a phone keyboard does not have
const KEYS: [string, string][] = [
  ['Esc', '\x1b'], ['Tab', '\t'], ['⇧Tab', '\x1b[Z'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['^C', '\x03'],
]
// the ship session has a conductor and a lanes window: tmux prefix + n / p switches, + z zooms a lane.
// The agent attaches through a grouped view session, so n / p only move this view; o / z act on the shared window.
const SHIP_KEYS: [string, string][] = [['win ›', '\x02n'], ['‹ win', '\x02p'], ['pane', '\x02o'], ['zoom', '\x02z']]
const keys = computed(() => (props.target === 'ship' ? [...KEYS, ...SHIP_KEYS] : KEYS))
const press = (seq: string) => { type(seq); term?.focus() }
</script>

<template>
  <Teleport to="body">
    <div class="full" :style="{ height }">
      <div class="bar">
        <b class="mono">{{ title }}</b>
        <span v-if="status" class="small muted">{{ status }}</span>
        <button class="btn small closebtn" title="detach — the session keeps running" @click="close">✕ Close</button>
      </div>
      <div ref="host" class="xt" @click="term?.focus()" />
      <div class="keys">
        <button v-for="[label, seq] in keys" :key="label" class="key mono" @mousedown.prevent @click="press(seq)">{{ label }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.full { position: fixed; top: 0; left: 0; width: 100vw; z-index: 1000; background: #0a0c0f; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--panel); border-bottom: 1px solid var(--line); }
.bar b { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.closebtn { margin-left: auto; }
.xt { flex: 1; min-height: 0; padding: 4px 6px; }
.keys { display: flex; gap: 4px; padding: 5px 6px; border-top: 1px solid #1c2129; background: #0d1014; }
.key { flex: 1; background: #161a20; color: #aab2bf; border: 1px solid #262c35; border-radius: 5px; font-size: 12.5px; padding: 6px 0; cursor: pointer; }
.key:hover { color: #fff; border-color: var(--accent); }
</style>
