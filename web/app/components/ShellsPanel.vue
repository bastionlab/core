<script setup lang="ts">
/** Termius-style shells: a fresh login shell in any dev box, as max. Each one is a tmux session the
 *  agent keeps on a private socket, so it survives closing the tab or the phone dropping off; ✕ ends it. */
const { data: boxes, refresh } = useFetch<any[]>('/api/shells', { server: false, immediate: false, default: () => [] })
usePoll(refresh, 10000)

const busy = ref('')
const error = ref('')
const open = ref<{ vmid: number, session: string, title: string } | null>(null)

const total = computed(() => (boxes.value ?? []).reduce((n, b) => n + b.shells.length, 0))
const show = (b: any, s: any) => { open.value = { vmid: b.vmid, session: s.session, title: `${b.name} · ${s.session}` } }

async function post(action: 'new' | 'kill', body: any) {
  error.value = ''
  try { return await $fetch<any>(`/api/shells/${action}`, { method: 'POST', body }) } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || e?.message
  } finally { busy.value = ''; refresh() }
}
async function create(b: any) {
  busy.value = `new:${b.vmid}`
  const r = await post('new', { vmid: b.vmid })
  if (r?.session) show(b, r)
}
function kill(b: any, s: any) {
  // something other than the bare shell is running — ask first
  if (!/^(zsh|bash|sh)$/.test(s.command) && !confirm(`${s.session} on ${b.name} is running ${s.command}. End it?`)) return
  busy.value = `kill:${b.vmid}:${s.session}`
  post('kill', { vmid: b.vmid, session: s.session })
}
</script>

<template>
  <Panel id="terminals" title="Terminals" :sub="total ? `${total} open` : undefined">
    <div class="tiles">
      <div v-for="b in boxes" :key="b.vmid" class="tile">
        <div class="th">
          <Icon name="dev" :size="15" class="ic" />
          <b>{{ b.name }}</b>
          <span class="faint small">CT {{ b.vmid }}</span>
          <button class="btn small new" :disabled="!!busy" :title="`new login shell on ${b.name} as max`" @click="create(b)">
            {{ busy === `new:${b.vmid}` ? '…' : '+ New shell' }}
          </button>
        </div>
        <div v-for="s in b.shells" :key="s.session" class="row" :class="{ att: s.attached }">
          <button class="open" :title="`started ${new Date(s.created * 1000).toLocaleString()}${s.attached ? ' · open somewhere' : ''}`" @click="show(b, s)">
            <span class="dot" :class="s.attached ? 'ok' : ''" />
            <span class="mono name">{{ s.session }}</span>
            <span class="what mono">{{ /^(zsh|bash|sh)$/.test(s.command) ? s.cwd : s.command }}</span>
            <span class="faint small age">{{ ago(s.created) }}</span>
          </button>
          <button class="x" :disabled="busy === `kill:${b.vmid}:${s.session}`" title="end this shell" @click="kill(b, s)">✕</button>
        </div>
      </div>
      <div v-if="!boxes?.length" class="faint small">No running dev boxes.</div>
    </div>
    <div v-if="error" class="small bad">{{ error }}</div>
    <TermFull
      v-if="open" :key="`${open.vmid}:${open.session}`" :vmid="open.vmid" target="shell" :session="open.session" :title="open.title"
      @close="open = null; refresh()"
    />
  </Panel>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 10px; }
.tile { border: 1px solid var(--line); border-radius: 10px; background: var(--panel-2); overflow: hidden; min-width: 0; align-self: start; }
.th { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px; min-width: 0; }
.th b { font-size: 13.5px; }
.ic { color: var(--faint); flex: none; }
.new { margin-left: auto; font-size: 12px; padding: 4px 10px; white-space: nowrap; }
.row { display: flex; align-items: stretch; border-top: 1px solid var(--line); min-width: 0; }
.row button { border: 0; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
.open { flex: 1; display: flex; align-items: center; gap: 8px; padding: 7px 12px; min-width: 0; text-align: left; }
.open:hover { background: var(--panel); }
.open .dot { width: 6px; height: 6px; box-shadow: none; flex: none; }
.name { font-size: 12.5px; flex: none; }
.what { flex: 1; min-width: 0; font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.age { flex: none; }
.x { flex: none; width: 38px; color: var(--faint); }
.x:hover { color: var(--bad); background: var(--panel); }
@media (max-width: 640px) {
  .open { min-height: 42px; }
  .new { min-height: 32px; }
}
</style>
