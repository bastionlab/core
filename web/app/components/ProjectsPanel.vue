<script setup lang="ts">
const props = defineProps<{ boxes: any[] | null, pending: boolean }>()
const emit = defineEmits<{ refresh: [] }>()

const busy = ref<Record<string, string>>({})
const errors = ref<Record<string, string>>({})
const logFor = ref<{ vmid: number, path: string, name: string, session: string } | null>(null)
const logText = ref('')
const logEl = ref<HTMLElement>()
const key = (vmid: number, p: any) => `${vmid}:${p.path}`

async function act(action: 'start' | 'stop', vmid: number, p: any) {
  const k = key(vmid, p)
  busy.value[k] = action
  delete errors.value[k]
  try {
    await $fetch(`/api/preview/${action}`, { method: 'POST', body: { vmid, path: p.path } })
    if (action === 'start') openLog(vmid, p)
  } catch (e: any) {
    errors.value[k] = e?.data?.statusMessage || e?.message
  } finally {
    delete busy.value[k]
    emit('refresh')
  }
}

async function loadLog() {
  if (!logFor.value) return
  try {
    const r: any = await $fetch('/api/preview/log', { query: { vmid: logFor.value.vmid, path: logFor.value.path } })
    const el = logEl.value
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40
    logText.value = stripAnsi(r.log || '').trimEnd()
    if (atBottom) nextTick(() => el && (el.scrollTop = el.scrollHeight))
  } catch {}
}
function openLog(vmid: number, p: any) {
  logFor.value = { vmid, path: p.path, name: p.name, session: p.session }
  logText.value = ''
  loadLog()
}
let timer: any
onMounted(() => (timer = setInterval(loadLog, 2000)))
onUnmounted(() => clearInterval(timer))

const state = (p: any) => (p.running ? 'running' : p.exited != null ? `exited (${p.exited})` : 'stopped')
</script>

<template>
  <Panel id="projects" title="Projects" sub="dev previews run in tmux on the dev box and are shared on the tailnet">
    <template #actions><button class="btn ghost small" @click="emit('refresh')">↻</button></template>
    <div v-if="!boxes" class="muted">{{ pending ? 'Loading…' : 'No data' }}</div>
    <div v-for="box in boxes ?? []" :key="box.vmid" class="box">
      <div class="bh">
        <span class="dot" :class="box.status === 'running' ? 'ok' : 'bad'" />
        <b>{{ box.name }}</b> <span class="faint small mono">CT {{ box.vmid }} · {{ box.ip }}</span>
        <code class="faint small ssh">ssh max@{{ box.name }}</code>
      </div>
      <div v-if="box.error" class="small bad">{{ box.error }}</div>
      <div class="projects">
        <div v-for="p in box.projects" :key="p.path" class="proj" :class="{ live: p.running }">
          <div class="ph">
            <b>{{ p.name }}</b>
            <span class="pill" :class="p.running ? 'ok' : p.exited != null ? 'bad' : ''">{{ state(p) }}</span>
          </div>
          <div class="small muted mono path">{{ p.path.replace('/home/max/', '~/') }}</div>
          <div class="small meta">
            <span v-if="p.branch" class="pill">⎇ {{ p.branch }}{{ p.dirty ? ' •' : '' }}</span>
            <code class="faint">{{ p.command ?? 'no dev script' }}</code>
          </div>
          <div v-if="p.urls.length" class="urls">
            <a v-for="u in p.urls" :key="u.port" :href="u.url" target="_blank" class="url" :class="{ pending: !u.url }">
              <span class="mono">:{{ u.port }}</span> {{ u.url ? 'Open ↗' : 'sharing…' }}
            </a>
          </div>
          <div v-else-if="p.running" class="small faint">waiting for a listening port…</div>
          <div v-if="errors[key(box.vmid, p)]" class="small bad">{{ errors[key(box.vmid, p)] }}</div>
          <div class="acts">
            <button v-if="!p.running" class="btn primary" :disabled="!p.command || !!busy[key(box.vmid, p)]" @click="act('start', box.vmid, p)">
              {{ busy[key(box.vmid, p)] === 'start' ? 'Starting…' : '▶ Start preview' }}
            </button>
            <template v-else>
              <button class="btn danger" :disabled="!!busy[key(box.vmid, p)]" @click="act('stop', box.vmid, p)">
                {{ busy[key(box.vmid, p)] === 'stop' ? 'Stopping…' : '■ Stop' }}
              </button>
            </template>
            <button v-if="p.running || p.exited != null" class="btn" @click="openLog(box.vmid, p)">Logs</button>
          </div>
        </div>
        <div v-if="!box.projects.length && !box.error" class="faint small">No git projects under ~/Projects</div>
      </div>
    </div>

    <div v-if="logFor" class="log">
      <div class="lh">
        <b>{{ logFor.name }}</b> <span class="muted small mono">tmux a -t {{ logFor.session }}</span>
        <button class="btn ghost small" style="margin-left:auto" @click="logFor = null">✕</button>
      </div>
      <pre ref="logEl">{{ logText || '…' }}</pre>
    </div>
  </Panel>
</template>

<style scoped>
.box + .box { margin-top: 18px; }
.bh { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.ssh { margin-left: auto; }
.projects { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.proj { background: var(--panel-2); border: 1px solid var(--line); border-radius: 9px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.proj.live { border-color: color-mix(in srgb, var(--ok) 50%, transparent); }
.ph { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.urls { display: flex; flex-wrap: wrap; gap: 6px; }
.url { padding: 3px 10px; border-radius: 6px; background: var(--ok-soft); color: var(--ok); font-size: 13px; }
.url.pending { background: var(--panel); color: var(--muted); }
.acts { display: flex; gap: 6px; margin-top: 4px; }
.log { margin-top: 14px; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.lh { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--panel-2); }
pre { margin: 0; padding: 10px 12px; max-height: 320px; overflow: auto; font: 12px/1.5 var(--mono); background: #0a0c0f; color: #d5d9e0; white-space: pre-wrap; word-break: break-all; }
</style>
