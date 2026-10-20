<script setup lang="ts">
useHead({ title: 'Notes · pve' })

const notes = ref<any[]>([])
const loaded = ref(false)
const error = ref('')
let last = 0
async function load(force = true) {
  // nothing changes behind the page's back except AI jobs, so poll fast only while one runs
  if (!force && !notes.value.some(n => n.job) && Date.now() - last < 60_000) return
  try {
    notes.value = (await $fetch<{ notes: any[] }>('/api/notes')).notes
    error.value = ''; last = Date.now()
  } catch (e: any) { error.value = e?.statusMessage || e?.message } finally { loaded.value = true }
}
usePoll(() => load(false), 2500)

const put = (n: any) => { const i = notes.value.findIndex(x => x.id === n.id); if (i < 0) notes.value.unshift(n); else notes.value[i] = n }
async function post(body: Record<string, any>) {
  const r = await $fetch<any>('/api/notes/action', { method: 'POST', body })
  if (r?.id) put(r)
  return r
}

const add = (text: string, images: string[], ai: boolean) => post({ action: 'add', text, images, ai })

async function patch(n: any, fields: Record<string, any>) {
  const before = { ...n }
  Object.assign(n, fields) // instant; the server's answer replaces it
  try { await post({ action: 'edit', id: n.id, ...fields }) } catch { Object.assign(n, before) }
}
async function act(n: any, action: string, extra: any = {}) {
  const { ok, no, ...rest } = extra
  try {
    if (action === 'delete') {
      await post({ action, id: n.id })
      notes.value = notes.value.filter(x => x.id !== n.id)
      close()
    } else {
      await post({ action, id: n.id, ...rest })
    }
    ok?.()
  } catch (e) { no?.(e) }
}

// the open note lives in the URL, so the phone's back button closes it
const route = useRoute(), router = useRouter()
const openId = computed(() => Number(route.query.n) || null)
const current = computed(() => notes.value.find(n => n.id === openId.value) ?? null)
const open = (id: number) => router.push({ query: { ...route.query, n: id } })
function close() { if (window.history.state?.back) router.back(); else router.replace({ query: { ...route.query, n: undefined } }) }

// --- filters (remembered per browser) ---
const q = ref('')
const view = ref<'active' | 'done' | 'archived'>('active')
const kind = ref('')
const tag = ref('')
const sort = ref<'new' | 'edited' | 'az'>('new')
onMounted(() => { try { sort.value = (localStorage.getItem('notes:sort') as any) || 'new' } catch {} })
watch(sort, v => { try { localStorage.setItem('notes:sort', v) } catch {} })
function pickTag(t: string) { tag.value = tag.value === t ? '' : t; if (openId.value) close() }

const inView = computed(() => notes.value.filter(n => n.state === view.value))
const counts = computed(() => Object.fromEntries((['active', 'done', 'archived'] as const).map(s => [s, notes.value.filter(n => n.state === s).length])))
const kindCounts = computed(() => Object.fromEntries(NOTE_KINDS.map(k => [k.id, inView.value.filter(n => n.kind === k.id).length])))
const tags = computed(() => {
  const c: Record<string, number> = {}
  for (const n of inView.value) if (n.topic) c[n.topic] = (c[n.topic] ?? 0) + 1
  return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
})
const allTags = ref(false)

const shown = computed(() => {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean)
  const list = inView.value.filter(n =>
    (!kind.value || n.kind === kind.value)
    && (!tag.value || n.topic === tag.value)
    && words.every(w => `${n.title}\n${n.body}\n${n.raw}\n${n.topic}`.toLowerCase().includes(w)))
  const by = sort.value === 'az' ? (a: any, b: any) => (a.title || '').localeCompare(b.title || '', 'de')
    : sort.value === 'edited' ? (a: any, b: any) => b.updated - a.updated
      : (a: any, b: any) => b.created - a.created
  return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || by(a, b))
})
const pinned = computed(() => shown.value.filter(n => n.pinned))
const rest = computed(() => shown.value.filter(n => !n.pinned))
const filtered = computed(() => !!(q.value || kind.value || tag.value))
function reset() { q.value = ''; kind.value = ''; tag.value = '' }

const asking = ref(false)
const search = ref<HTMLInputElement>()
const compose = ref<any>()
const onKey = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement
  if (openId.value || el.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === '/') { e.preventDefault(); search.value?.focus() }
  if (e.key === 'n') { e.preventDefault(); compose.value?.focus() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="notes">
    <NoteCompose
      ref="compose" class="capture" draft-key="notes:draft" ai-toggle :save="add"
      placeholder="Throw in a thought — messy is fine, paste screenshots too. The AI tidies it up."
    />

    <div class="bar">
      <div class="views">
        <button v-for="v in (['active', 'done', 'archived'] as const)" :key="v" type="button" class="vw" :class="{ on: view === v }" @click="view = v">
          {{ { active: 'Notes', done: 'Done', archived: 'Archive' }[v] }} <span class="n">{{ counts[v] }}</span>
        </button>
      </div>
      <div class="find">
        <input ref="search" v-model="q" class="search" type="search" placeholder="Search  /" enterkeyhint="search">
        <select v-model="sort" title="sort">
          <option value="new">Newest</option>
          <option value="edited">Last edited</option>
          <option value="az">A–Z</option>
        </select>
      </div>
      <button type="button" class="btn ghost" :class="{ on: asking }" title="ask the local model about your notes" @click="asking = !asking">
        <Icon name="spark" :size="15" />Ask
      </button>
    </div>

    <AskPanel
      v-if="asking" scope="notes" placeholder="Ask about your notes…"
      :examples="['Which ideas have I not started yet?', 'Summarise my ideas about the dashboard', 'Which of my ideas would be quickest to build?', 'What did I note down this week?']"
    />

    <div class="chips">
      <button v-for="k in NOTE_KINDS.filter(k => kindCounts[k.id])" :key="k.id" type="button" class="chip" :class="{ on: kind === k.id }" @click="kind = kind === k.id ? '' : k.id">
        {{ k.icon }} {{ k.label }} <span class="n">{{ kindCounts[k.id] }}</span>
      </button>
      <span v-if="tags.length" class="div" />
      <button v-for="[t, c] in (allTags ? tags : tags.slice(0, 12))" :key="t" type="button" class="chip tag" :class="{ on: tag === t }" @click="pickTag(t)">
        {{ t }} <span class="n">{{ c }}</span>
      </button>
      <button v-if="tags.length > 12" type="button" class="chip more" @click="allTags = !allTags">{{ allTags ? 'less' : `+${tags.length - 12}` }}</button>
      <button v-if="filtered" type="button" class="chip clear" @click="reset">✕ clear</button>
    </div>

    <div v-if="error" class="bad pad">Notes could not load: {{ error }}</div>
    <div v-else-if="loaded && !shown.length" class="muted pad">
      <template v-if="filtered">Nothing matches.</template>
      <template v-else-if="view === 'active'">No notes yet — type anything above.</template>
      <template v-else>Nothing here.</template>
    </div>

    <template v-if="pinned.length">
      <h2 class="sec">Pinned</h2>
      <div class="masonry">
        <NoteCard v-for="n in pinned" :key="n.id" :note="n" @open="open(n.id)" @patch="f => patch(n, f)" @tag="pickTag" />
      </div>
      <h2 v-if="rest.length" class="sec">Others</h2>
    </template>
    <div class="masonry">
      <NoteCard v-for="n in rest" :key="n.id" :note="n" @open="open(n.id)" @patch="f => patch(n, f)" @tag="pickTag" />
    </div>

    <NoteView
      v-if="current" :note="current" :notes="notes"
      @close="close" @open="id => router.replace({ query: { ...route.query, n: id } })" @tag="pickTag"
      @patch="f => patch(current, f)" @act="(a, x) => act(current, a, x)"
    />
  </div>
</template>

<style scoped>
.notes { max-width: 1180px; margin: 0 auto; }
.capture { max-width: 680px; margin: 0 auto 18px; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.views { display: flex; gap: 2px; }
.vw { padding: 4px 10px; border-radius: 6px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; }
.vw.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.n { font-size: 11px; opacity: .7; }
.find { display: flex; gap: 8px; flex: 1; justify-content: flex-end; }
.search { flex: 1; min-width: 140px; max-width: 360px; padding: 6px 10px; font-size: 13px; }
.bar select { padding: 6px 8px; font-size: 13px; }
.bar .btn.on { color: var(--accent); background: var(--accent-soft); }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 14px; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.chip:hover { color: var(--text); }
.chip.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.chip.tag { color: var(--accent); background: transparent; }
.chip.tag.on { background: var(--accent-soft); }
.chip.clear { border-style: dashed; }
.div { width: 1px; height: 16px; background: var(--line-2); margin: 0 4px; }
.masonry { columns: 290px; column-gap: 12px; }
.sec { margin-top: 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); }
.pad { padding: 48px 0; text-align: center; }
@media (max-width: 640px) {
  .find { order: 3; flex-basis: 100%; min-width: 0; }
  /* an input's natural width is wide on iOS; let it shrink so the row never pushes the page sideways */
  .search { flex: 1 1 0; width: 0; min-width: 0; max-width: none; }
  .find select { flex: none; max-width: 40%; }
  .bar .btn.ghost { margin-left: auto; }
  /* one swipeable row instead of a wall of chips */
  .chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 -12px 14px; padding: 0 12px; }
  .chip { flex: none; }
  .masonry { columns: 1; }
}
</style>
