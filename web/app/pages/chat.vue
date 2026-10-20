<script setup lang="ts">
import type { Turn } from '~/composables/useAsk'
import { COMMANDS, parseCommand } from '~/utils/commands'
import type { Question } from '~/utils/questions'
useHead({ title: 'Chat · pve' })
const { chats, current, currentId, create, remove, load, save, touch, status } = useChats()
const claude = useClaude(save)
onMounted(() => {
  load()
  // a Claude turn keeps running on pve while this page is closed: pick up every one that hadn't finished
  for (const c of chats.value) for (const t of c.turns) if (t.ct && !t.fin) claude.attach(t)
})

const turns = computed<Turn[]>({ get: () => current.value?.turns ?? [], set: v => (current.value!.turns = v) })
const { ask, run, stop: stopLocal, busy: busyLocal, models, model: localModel } = useAsk('chat', turns as any, touch)

// which engine a new chat starts with is remembered; each chat keeps its own afterwards
const lastEngine = () => { try { return localStorage.getItem('chat.engine') === 'claude' ? 'claude' : 'local' } catch { return 'local' } }
const engine = computed<'local' | 'claude'>({
  get: () => current.value?.engine ?? lastEngine(),
  set: (v) => {
    if (current.value) current.value.engine = v
    try { localStorage.setItem('chat.engine', v) } catch {}
    save()
  },
})
const isClaude = computed(() => engine.value === 'claude')
// model + effort: each chat keeps its own, a new chat starts with the last ones picked
const pref = (k: string, d: string) => { try { return localStorage.getItem(k) || d } catch { return d } }
function chatSetting(field: 'model' | 'effort', key: string, d: string) {
  return computed({
    get: () => current.value?.[field] ?? pref(key, d),
    set: (v: string) => {
      if (current.value) current.value[field] = v
      try { localStorage.setItem(key, v) } catch {}
      save()
    },
  })
}
const ccModel = chatSetting('model', 'chat.claude.model', 'opus')
const ccEffort = chatSetting('effort', 'chat.claude.effort', 'medium')
const auto = computed({ get: () => !!current.value?.auto, set: (v) => { if (current.value) current.value.auto = v; save() } })
const busy = computed(() => turns.value.some(t => t.busy))
const stop = () => (isClaude.value && current.value ? claude.stop(current.value) : stopLocal())
function drop(id: string) {
  const c = chats.value.find(x => x.id === id)
  if (c?.turns.some(t => t.busy && t.ct)) claude.stop(c)
  remove(id)
}

const body = ref<HTMLElement>()
const away = ref(false) // scrolled up: offer a jump back to the newest message
const onScroll = () => { const el = body.value; away.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 300 }
const toBottom = (smooth = true) => body.value?.scrollTo({ top: body.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
watch(() => turns.value.map(t => t.a.length + t.r.length + (t.tools?.length ?? 0)).join(), () => {
  const el = body.value
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) nextTick(() => (el.scrollTop = el.scrollHeight))
  nextTick(onScroll)
})
watch(currentId, () => nextTick(() => { toBottom(false); onScroll() }))

/** ask the last question again: replaces a failed or stopped answer, or rolls the dice again on a local model */
const canRetry = computed(() => !busy.value && !!turns.value.at(-1)?.q && (!isClaude.value || !!turns.value.at(-1)!.error))
function retry() {
  const c = current.value
  if (!c || !canRetry.value) return
  const { q, imgs } = c.turns.pop()!
  save()
  send(q, imgs)
}
const STATUS = { busy: 'working…', input: 'needs your answer' } as const

// a short line above the input confirming what a command did
const flash = ref('')
let flashT: any
function say(s: string) { flash.value = s; clearTimeout(flashT); flashT = setTimeout(() => (flash.value = ''), 3000) }

// note titles for /note, fetched once
const noteTitles = ref<string[]>([])
onMounted(() => $fetch<any>('/api/notes').then(r => (noteTitles.value = (r.notes ?? []).filter((n: any) => n.state === 'active').map((n: any) => n.title))).catch(() => {}))
const commands = computed(() => COMMANDS.filter(c => isClaude.value || !c.claude).map(c => ({
  ...c,
  choices: c.name === 'model' ? (isClaude.value ? CLAUDE_MODELS.map(m => m.id) : models.value.map((m: any) => m.name))
    : c.name === 'effort' ? CLAUDE_EFFORTS : c.name === 'note' ? noteTitles.value : undefined,
})))

/** our slash commands; false = not one of them, so it goes to the model as typed (Claude's own skills) */
function command(text: string): boolean {
  const p = parseCommand(text)
  if (!p?.cmd) return false
  const { cmd, arg } = p
  if (cmd.claude && !isClaude.value) return say(`/${cmd.name} needs Claude`), true
  if (busy.value && !cmd.busy) return say('wait until the answer is done (or /stop)'), true
  switch (cmd.name) {
    case 'clear': clear(); return true
    case 'new': create(); return true
    case 'stop': if (busy.value) stop(); return true
    case 'retry': canRetry.value ? retry() : say(isClaude.value ? 'only a failed or stopped answer can be retried' : 'nothing to retry'); return true
    case 'auto': case 'readonly':
      auto.value = cmd.name === 'auto'
      say(auto.value ? '⚡ Auto: Claude may change things' : '👁 Read-only: Claude can only look')
      return true
    case 'effort':
      if (!CLAUDE_EFFORTS.includes(arg.toLowerCase())) return say(`effort is one of ${CLAUDE_EFFORTS.join(', ')}`), true
      ccEffort.value = arg.toLowerCase(); say(`effort → ${ccEffort.value}`); return true
    case 'model': {
      const a = arg.toLowerCase()
      if (isClaude.value) {
        const m = CLAUDE_MODELS.find(m => m.id === a) ?? CLAUDE_MODELS.find(m => m.label.toLowerCase().startsWith(a))
        if (!m) return say(`model is one of ${CLAUDE_MODELS.map(m => m.id).join(', ')}`), true
        ccModel.value = m.id; say(`model → ${m.label}`); return true
      }
      const m = models.value.find((m: any) => m.name === a) ?? models.value.find((m: any) => m.name.toLowerCase().includes(a))
      if (!m) return say(`no local model “${arg}”`), true
      localModel.value = m.name; say(`model → ${m.name}`); return true
    }
  }
  if (cmd.prompt) { deliver(cmd.prompt(arg)); return true }
  return false
}
function send(q: string, imgs: string[] = []) {
  if (!imgs.length && q.trim().startsWith('/') && command(q)) return
  deliver(q, imgs)
}
function deliver(q: string, imgs: string[] = []) {
  if (isClaude.value && current.value) {
    Object.assign(current.value, { engine: 'claude', model: ccModel.value, effort: ccEffort.value })
    claude.ask(current.value, q, imgs)
  } else ask(q)
  nextTick(touch)
}
/** like Claude Code's /clear: the screen empties and the model starts over (Claude gets a fresh session) */
function clear() {
  const c = current.value
  if (!c || busy.value || !c.turns.length) return
  c.turns = []
  if (c.session) c.session = crypto.randomUUID()
  save()
}
const EXAMPLES = {
  local: ['What can you do?', 'Summarise how my server is doing', 'Explain ZFS snapshots vs backups', 'What happened in tech news today?'],
  claude: ['Which of my notes are ideas I could build?', 'Is anything broken on the server right now?', 'Why did the last backup take so long?', 'What changed in the dashboard today?'],
}
const open = ref(false) // conversation list on phones

// open questions sit above the input, apart from the chat; typing a message instead answers them too
const pending = computed<{ t: Turn, qs: Question[] } | null>(() => {
  const t = turns.value.at(-1)
  if (!t || t.busy || t.clear || t.error || t.answered) return null
  const qs = splitQuestions(t.a).qs
  return qs ? { t, qs } : null
})
const qsMin = ref(false)
watch(() => pending.value?.t, () => (qsMin.value = false))
function answer(text: string, picked: Record<number, string[]>) {
  if (!pending.value) return
  pending.value.t.answered = picked
  send(text)
}
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
          <span class="t"><span v-if="c.engine === 'claude'" class="cl" title="Claude">✳</span>{{ c.title }}</span>
          <span v-if="status(c)" class="small st" :class="status(c)"><span class="sd" />{{ STATUS[status(c) as 'busy'] }}</span>
          <span v-else class="small faint">{{ ago(c.at / 1000) }}</span>
          <span class="x" title="delete" @click.stop="remove(c.id)">✕</span>
        </button>
      </div>
      <ClaudeUsage />
      <a href="https://ai.example-tailnet.ts.net" target="_blank" class="small muted webui" title="for files, images, uncensored models">Open WebUI ↗</a>
    </aside>

    <section class="main">
      <div class="mhead">
        <button class="btn ghost only-phone" title="conversations" @click="open = !open">☰</button>
        <b class="ttl">{{ current?.title ?? 'Chat' }}</b>
        <span v-if="status(current) === 'input'" class="st input small hide-phone"><span class="sd" />your turn</span>
        <div class="seg" role="group" aria-label="engine">
          <button :class="{ on: !isClaude }" :disabled="busy" title="local model on the 3060 (Ollama)" @click="engine = 'local'">Local</button>
          <button :class="{ on: isClaude }" :disabled="busy" title="Claude Code on pve, your subscription" @click="engine = 'claude'">Claude</button>
        </div>
        <button
          v-if="isClaude" class="btn ghost autobtn" :class="{ armed: auto }" :disabled="busy"
          :title="auto ? 'Claude may change files, run commands and deploy. Click for read-only' : 'Claude can only look. Click to let it change things'"
          @click="auto = !auto"
        >{{ auto ? '⚡ Auto' : '👁 Read-only' }}</button>
        <button
          v-if="turns.length" class="btn ghost clearbtn" :disabled="busy"
          title="clear this chat and start fresh (same as typing /clear)" @click="clear"
        >⟲</button>
        <button class="btn ghost only-phone plus" title="new chat" @click="create()">+</button>
      </div>

      <div class="bodywrap">
      <div ref="body" class="body" @scroll.passive="onScroll">
        <div v-if="!turns.length" class="empty muted">
          <div class="hero" :class="engine">
            <span class="logo">{{ isClaude ? '✳' : '◆' }}</span>
            <b>{{ isClaude ? 'Claude on pve' : 'Local model' }}</b>
            <span class="small faint">{{ isClaude ? (auto ? 'can change files, run commands and deploy' : 'read-only: looks, never touches') : 'private, runs on the 3060 · web search + weather' }}</span>
          </div>
          <div class="examples">
            <button v-for="ex in EXAMPLES[engine]" :key="ex" class="pill" @click="send(ex)">{{ ex }}</button>
          </div>
        </div>
        <AskTurns v-else dock :turns="turns" :retry="canRetry" @run="p => run(p)" @answer="send" @retry="retry" />
      </div>
      <button v-if="away" class="jump" title="newest message" @click="toBottom()">↓</button>
      </div>

      <div v-if="pending" class="dock" :class="{ min: qsMin }">
        <div class="dhead small">
          <span class="warn">❓ {{ pending.qs.length === 1 ? 'Claude needs your answer' : `${pending.qs.length} questions for you` }}</span>
          <button type="button" class="btn ghost dmin" :title="qsMin ? 'show the questions' : 'tuck them away'" @click="qsMin = !qsMin">{{ qsMin ? 'show ▴' : 'hide ▾' }}</button>
        </div>
        <AskQuestions v-show="!qsMin" :key="turns.length" :qs="pending.qs" @answer="answer" />
      </div>

      <div class="bar" :class="{ armed: isClaude && auto }">
        <div v-if="flash" class="flash small">{{ flash }}</div>
        <AskBar
          :busy="busy" :models="isClaude ? [{ name: 'claude' }] : models" :commands="commands"
          :draft-key="current ? `chat:draft:${current.id}` : undefined" :images="isClaude"
          :placeholder="pending ? 'Or type your own answer…' : !isClaude ? 'Message the local model…' : auto ? 'Tell Claude what to change…' : 'Ask Claude (read-only)…'"
          @submit="send" @stop="stop"
        >
          <template v-if="isClaude" #opts>
            <select v-model="ccModel" title="Claude model" :disabled="busy">
              <option v-for="m in CLAUDE_MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <select v-model="ccEffort" title="effort: how long Claude thinks before and while answering" :disabled="busy">
              <option v-for="e in CLAUDE_EFFORTS" :key="e" :value="e">{{ e }} effort</option>
            </select>
          </template>
        </AskBar>
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
.main { position: relative; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); min-height: 0; min-width: 0; }
.mhead { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--line); min-height: 48px; }
.ttl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.bodywrap { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.body { flex: 1; overflow-y: auto; padding: 4px 16px; min-height: 0; }
.dock { flex-shrink: 0; max-height: 55dvh; overflow-y: auto; border-top: 1px solid var(--line); padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 6px; }
.dock.min { padding-bottom: 6px; }
.dhead { display: flex; align-items: center; gap: 8px; }
.dmin { margin-left: auto; font-size: 12px; padding: 2px 8px; }
.flash { color: var(--accent); padding: 2px 0 6px 31px; }
.bar { border-top: 1px solid var(--line); padding: 6px 8px 6px 12px; }
.seg { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; flex-shrink: 0; }
.seg button { background: transparent; border: 0; color: var(--muted); font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer; }
.seg button.on { background: var(--accent-soft); color: var(--accent); }
.seg button:disabled { cursor: default; }
.autobtn { font-size: 12px; padding: 4px 10px; flex-shrink: 0; }
.autobtn.armed { color: var(--warn); background: var(--warn-soft); border-color: transparent; }
.bar select { padding: 5px 8px; font-size: 12px; }
@media (max-width: 640px) { .bar select { flex: 1 1 40%; font-size: 16px; } }
.clearbtn { font-size: 14px; padding: 4px 9px; flex-shrink: 0; }
.bar.armed { box-shadow: inset 0 2px 0 var(--warn); }
.cl { color: #d97757; margin-right: 5px; }
.empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 30px 10px; text-align: center; }
.hero { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.hero b { color: var(--text); font-size: 16px; }
.hero .logo { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; font-size: 24px; margin-bottom: 6px; background: var(--accent-soft); color: var(--accent); }
.hero.claude .logo { background: color-mix(in srgb, #d97757 16%, transparent); color: #d97757; }
.st { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; }
.st .sd { width: 7px; height: 7px; border-radius: 50%; }
.st.busy { color: var(--accent); }
.st.busy .sd { background: var(--accent); animation: sdpulse 1.4s ease-in-out infinite; }
.st.input { color: var(--warn); }
.st.input .sd { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
@keyframes sdpulse { 50% { opacity: .3; transform: scale(.7); } }
.jump { position: absolute; right: 18px; bottom: 12px; z-index: 5; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line-2); background: var(--panel-2); color: var(--text); font-size: 16px; cursor: pointer; box-shadow: 0 4px 14px rgba(0, 0, 0, .35); }
.jump:hover { border-color: var(--faint); }
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
  .hide-phone { display: none; }
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
