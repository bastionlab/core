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
    <div v-if="open" class="scrim" @click="open = false" />
    <aside :class="{ open }">
      <button class="btn primary new" @click="create(); open = false">+ New chat</button>
      <div class="list">
        <button
          v-for="c in chats" :key="c.id" class="conv" :class="{ on: c.id === currentId }"
          @click="currentId = c.id; open = false"
        >
          <span class="t">{{ c.title }}</span>
          <span class="small faint">{{ ago(c.at / 1000) }}</span>
          <span class="x" title="delete" @click.stop="remove(c.id)">✕</span>
        </button>
      </div>
      <a href="https://ai.example-tailnet.ts.net" target="_blank" class="small muted webui" title="for files, images, uncensored models">Open WebUI ↗</a>
    </aside>

    <section class="main">
      <div class="mhead">
        <button class="btn ghost only-phone" title="conversations" @click="open = !open">☰</button>
        <b class="ttl">{{ current?.title ?? 'Chat' }}</b>
        <button class="btn ghost only-phone plus" title="new chat" @click="create()">+</button>
      </div>

      <div ref="body" class="body">
        <div v-if="!turns.length" class="empty muted">
          <Icon name="chat" :size="28" class="big" />
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
/* fills the viewport: .wrap's top padding above, its bottom padding cancelled by the negative margin */
.chat { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 14px; height: calc(100dvh - 48px); min-height: 420px; margin-bottom: -36px; }
aside { display: flex; flex-direction: column; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; min-height: 0; }
.new { justify-content: center; }
.list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; min-height: 0; }
.conv { position: relative; display: flex; flex-direction: column; gap: 1px; text-align: left; background: transparent; border: 0; border-radius: 8px; padding: 7px 26px 7px 10px; color: var(--muted); font: inherit; cursor: pointer; }
.conv:hover { background: var(--panel-2); color: var(--text); }
.conv.on { background: var(--panel-2); color: var(--text); }
.conv .t { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv .x { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); opacity: 0; color: var(--muted); font-size: 11px; padding: 4px; }
.conv:hover .x, .conv.on .x { opacity: 1; }
.conv .x:hover { color: var(--bad); }
.webui { border-top: 1px solid var(--line); padding: 10px 2px 0; }
.main { display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); min-height: 0; min-width: 0; }
.mhead { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--line); min-height: 48px; }
.ttl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.body { flex: 1; overflow-y: auto; padding: 4px 16px; min-height: 0; }
.bar { border-top: 1px solid var(--line); padding: 6px 8px 6px 12px; }
.empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 30px 10px; text-align: center; }
.big { color: var(--faint); }
.examples { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 560px; }
.examples .pill { cursor: pointer; font: inherit; font-size: 12px; padding: 4px 11px; }
.examples .pill:hover { color: var(--text); border-color: var(--faint); }
.only-phone { display: none; }
.scrim { display: none; }
@media (max-width: 760px) {
  .chat { grid-template-columns: minmax(0, 1fr); }
  aside {
    display: none; position: fixed; z-index: 60; left: 0; top: 0; bottom: 0; width: min(300px, 84vw);
    border-radius: 0 var(--radius) var(--radius) 0; border-left: 0; padding: 16px 12px calc(16px + env(safe-area-inset-bottom));
    box-shadow: 0 0 40px rgba(0, 0, 0, .6);
  }
  aside.open { display: flex; }
  .scrim { display: block; position: fixed; inset: 0; z-index: 55; background: rgba(0, 0, 0, .5); }
  .only-phone { display: inline-flex; padding: 4px 10px; font-size: 16px; }
  .mhead { padding: 6px 6px; }
  .body { padding: 4px 12px; }
  .conv { padding: 10px 30px 10px 10px; }
  .conv .x { opacity: 1; }
}
@media (max-width: 640px) {
  /* .wrap: 12px on top, 28px + tab bar below */
  .chat { height: calc(100dvh - 24px - var(--tabbar, 0px)); margin-bottom: -16px; min-height: 0; }
}
</style>
