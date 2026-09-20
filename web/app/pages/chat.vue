<script setup lang="ts">
import type { Turn } from '~/composables/useAsk'
useHead({ title: 'Chat · pve' })
const { chats, current, currentId, create, remove, load, touch } = useChats()
onMounted(load)

const turns = computed<Turn[]>({ get: () => current.value?.turns ?? [], set: v => (current.value!.turns = v) })
const { ask, run, stop, busy, models } = useAsk('chat', turns as any, touch)

const body = ref<HTMLElement>()
watch(() => turns.value.map(t => t.a.length + t.r.length).join(), () => {
  const el = body.value
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) nextTick(() => (el.scrollTop = el.scrollHeight))
})
function send(q: string) { ask(q); nextTick(touch) }
const open = ref(false) // conversation list on phones
</script>

<template>
  <div class="chat">
    <aside :class="{ open }">
      <button class="btn primary new" @click="create(); open = false">＋ New chat</button>
      <div class="list">
        <button
          v-for="c in chats" :key="c.id" class="conv" :class="{ on: c.id === currentId }"
          @click="currentId = c.id; open = false"
        >
          <span class="t">{{ c.title }}</span>
          <span class="small faint">{{ c.turns.length }} · {{ ago(c.at / 1000) }}</span>
          <span class="x" title="delete" @click.stop="remove(c.id)">✕</span>
        </button>
      </div>
      <a href="https://ai.example-tailnet.ts.net" target="_blank" class="small muted webui">Open WebUI ↗ <span class="faint">for files, images, uncensored models</span></a>
    </aside>

    <section class="main">
      <div class="mhead">
        <button class="btn ghost only-phone" @click="open = !open">☰</button>
        <b>{{ current?.title ?? 'Chat' }}</b>
        <span class="muted small">local models · history stays in this browser</span>
      </div>

      <div ref="body" class="body">
        <div v-if="!turns.length" class="empty muted">
          <p>Ask anything. The server's live state is available to the model, and it can search the web.</p>
          <div class="examples">
            <button v-for="ex in ['What can you do?', 'Summarise how my server is doing', 'Explain ZFS snapshots vs backups', 'What happened in tech news today?']" :key="ex" class="pill" @click="send(ex)">{{ ex }}</button>
          </div>
        </div>
        <AskTurns v-else :turns="turns" @run="p => run(p)" />
      </div>

      <div class="bar">
        <AskBar :busy="busy" :models="models" placeholder="Message the local model…" @submit="send" @stop="stop" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.chat { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 16px; height: calc(100vh - 140px); min-height: 420px; }
aside { display: flex; flex-direction: column; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; min-height: 0; }
.new { justify-content: center; }
.list { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; flex: 1; min-height: 0; }
.conv { position: relative; display: flex; flex-direction: column; gap: 2px; text-align: left; background: transparent; border: 0; border-radius: 8px; padding: 7px 24px 7px 9px; color: var(--text); font: inherit; cursor: pointer; }
.conv:hover { background: var(--panel-2); }
.conv.on { background: var(--accent-soft); color: var(--accent); }
.conv .t { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv .x { position: absolute; right: 6px; top: 7px; opacity: 0; color: var(--muted); font-size: 11px; }
.conv:hover .x { opacity: 1; }
.webui { border-top: 1px solid var(--line); padding-top: 10px; }
.main { display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); min-height: 0; }
.mhead { display: flex; align-items: baseline; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.body { flex: 1; overflow-y: auto; padding: 4px 14px; min-height: 0; }
.bar { border-top: 1px solid var(--line); padding: 8px 12px; }
.empty { padding: 40px 10px; text-align: center; }
.examples { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 12px; }
.examples .pill { cursor: pointer; font: inherit; font-size: 12px; }
.only-phone { display: none; }
@media (max-width: 760px) {
  .chat { grid-template-columns: minmax(0, 1fr); height: calc(100vh - 190px); }
  aside { display: none; position: absolute; z-index: 5; width: 240px; max-height: 70vh; }
  aside.open { display: flex; }
  .only-phone { display: inline-flex; }
}
</style>
