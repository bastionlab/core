<script setup lang="ts">
useHead({ title: 'Learn · pve' })

const lessons = ref<any[]>([])
const today = ref('')
const skills = ref<any[]>([])
const nextWeek = ref('')
const loaded = ref(false)
const error = ref('')
let last = 0
async function load(force = true) {
  // only Claude changes things behind the page's back: poll fast while it writes
  if (!force && !lessons.value.some(l => ['writing', 'pending'].includes(l.status) || ['writing', 'pending'].includes(l.skills)) && Date.now() - last < 60_000) return
  try {
    const r = await $fetch<{ lessons: any[], skills: any[], today: string, next: string }>('/api/learn')
    lessons.value = r.lessons; today.value = r.today; skills.value = r.skills; nextWeek.value = r.next
    error.value = ''; last = Date.now()
  } catch (e: any) { error.value = e?.statusMessage || e?.message } finally { loaded.value = true }
}
usePoll(() => load(false), 4000)

const put = (l: any) => { const i = lessons.value.findIndex(x => x.id === l.id); if (i < 0) lessons.value.unshift(l); else lessons.value[i] = l }
async function post(body: Record<string, any>) {
  try {
    const r = await $fetch<any>('/api/learn/action', { method: 'POST', body })
    if (r?.id) put(r)
    if (r?.skills && !r.id) skills.value = r.skills
    if (body.action === 'done' && body.done) setTimeout(() => load(), 1500)
    if (body.action === 'delete') { lessons.value = lessons.value.filter(x => x.id !== body.id); close() }
    error.value = ''
    return r
  } catch (e: any) { error.value = e?.data?.statusMessage || e?.statusMessage || e?.message }
}

// the open lesson lives in the URL, so the phone's back button closes it
const route = useRoute(), router = useRouter()
const openId = computed(() => Number(route.query.l) || null)
const current = computed(() => lessons.value.find(l => l.id === openId.value && l.lesson) ?? null)
const open = (id: number) => router.push({ query: { ...route.query, l: id } })
function close() { if (window.history.state?.back) router.back(); else router.replace({ query: { ...route.query, l: undefined } }) }

const written = computed(() => lessons.value.filter(l => l.status !== 'queued'))
// the hero: what is being written, else the newest lesson still open, else the newest one
const hero = computed(() => written.value.find(l => l.status === 'writing' || l.status === 'pending')
  ?? written.value.find(l => l.lesson && !l.done) ?? written.value.find(l => l.lesson) ?? written.value.find(l => l.status === 'failed') ?? null)
const nextLabel = computed(() => nextWeek.value ? new Date(`${nextWeek.value}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) : 'Monday')
const working = computed(() => lessons.value.filter(l => l.status === 'writing' || l.status === 'pending'))
const upNext = computed(() => lessons.value.filter(l => l.status === 'queued').reverse())
const ready = computed(() => lessons.value.filter(l => l.lesson))
const failed = computed(() => lessons.value.filter(l => l.status === 'failed' && l !== hero.value))

const stats = computed(() => {
  const done = ready.value.filter(l => l.done)
  let right = 0, answered = 0
  for (const l of ready.value) { const s = quizScore(l); right += s.right; answered += s.answered }
  return { streak: streak(lessons.value), done: done.length, total: ready.value.length, quiz: answered ? Math.round((100 * right) / answered) : null }
})

// --- the owner's own topics ---
const topic = ref('')
async function ask(now: boolean) {
  const t = topic.value.trim()
  if (!t && !now) return
  if (await post({ action: now ? 'now' : 'queue', topic: t })) topic.value = ''
  load()
}

// --- library filters ---
const q = ref('')
const track = ref('')
const show = ref<'all' | 'open' | 'done'>('all')
const tracks = computed(() => {
  const c: Record<string, number> = {}
  for (const l of ready.value) c[l.lesson.track] = (c[l.lesson.track] ?? 0) + 1
  return Object.entries(c).sort((a, b) => b[1] - a[1])
})
const library = computed(() => {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean)
  return ready.value.filter(l => (!track.value || l.lesson.track === track.value)
    && (show.value === 'all' || (show.value === 'done') === !!l.done)
    && words.every(w => `${l.lesson.title} ${l.lesson.summary} ${l.lesson.track} ${l.topic}`.toLowerCase().includes(w)))
})

const elapsed = (l: any) => Math.max(0, Math.round((Date.now() / 1000 - l.created) / 60))
</script>

<template>
  <div class="learn">
    <p v-if="error" class="errbox">{{ error }}</p>

    <!-- today -->
    <section class="today">
      <div class="label faint small">This week · next lesson {{ nextLabel }}, 12:00</div>
      <div v-if="!loaded" class="muted small">Loading…</div>
      <template v-else-if="hero?.lesson">
        <div class="hero" @click="open(hero.id)">
          <div class="pills">
            <span class="pill accent">{{ trackIcon(hero.lesson.track) }} {{ hero.lesson.track }}</span>
            <span class="pill">{{ hero.lesson.level }}</span>
            <span v-if="hero.done" class="pill ok">✓ finished</span>
          </div>
          <h1>{{ hero.lesson.title }}</h1>
          <p class="muted">{{ hero.lesson.summary }}</p>
          <div class="bar"><i :style="{ width: `${lessonProgress(hero).pct}%` }" /></div>
          <button type="button" class="btn primary go">{{ hero.done ? 'Open again' : lessonProgress(hero).done ? 'Continue' : 'Start the hour' }} →</button>
        </div>
      </template>
      <div v-else-if="hero && (hero.status === 'writing' || hero.status === 'pending')" class="hero wait">
        <span class="spin" />
        <div>
          <b>Claude is writing {{ hero.topic ? `“${hero.topic}”` : 'this week’s lesson' }}…</b>
          <div class="muted small">usually 3–6 minutes{{ hero.status === 'writing' ? ` · ${elapsed(hero)} min so far` : ' · waiting for the one before' }}</div>
        </div>
      </div>
      <div v-else-if="hero?.status === 'failed'" class="hero wait">
        <div>
          <b class="bad">The lesson failed</b>
          <div class="muted small">{{ hero.error }}</div>
        </div>
        <button type="button" class="btn" @click="post({ action: 'write', id: hero.id })">Retry</button>
      </div>
      <div v-else class="hero wait">
        <div>
          <b>The first lesson arrives {{ nextLabel }} at 12:00.</b>
        </div>
        <button type="button" class="btn primary" @click="ask(true)">Write one now</button>
      </div>
    </section>

    <div class="stats">
      <div><b>{{ stats.streak }}</b><span>🔥 weeks</span></div>
      <div><b>{{ stats.done }}<small>/{{ stats.total }}</small></b><span>finished</span></div>
      <div><b>{{ stats.quiz == null ? '–' : `${stats.quiz}%` }}</b><span>quiz right</span></div>
    </div>

    <!-- topics the owner wants -->
    <Panel title="Want to learn something?" id="learn-ask" :sub="upNext.length ? `${upNext.length} up next` : ''">
      <form class="ask" @submit.prevent="ask(false)">
        <input v-model="topic" type="text" placeholder="e.g. Rust ownership, BGP, Kubernetes operators…" enterkeyhint="done" maxlength="300">
        <div class="btns">
          <button type="submit" class="btn" :disabled="!topic.trim()">+ Up next</button>
          <button type="button" class="btn primary" :disabled="!topic.trim()" @click="ask(true)">Write now</button>
        </div>
      </form>
      <ul v-if="upNext.length || working.length" class="queue">
        <li v-for="l in working.filter(x => x !== hero)" :key="l.id"><span class="spin sm" /> {{ l.topic || 'Claude’s pick' }} <span class="faint small">{{ l.status === 'writing' ? 'writing…' : 'waiting' }}</span></li>
        <li v-for="(l, i) in upNext" :key="l.id">
          <span class="faint small">#{{ i + 1 }}</span> {{ l.topic }}
          <span class="sp" />
          <button type="button" class="btn ghost" title="write it now" @click="post({ action: 'write', id: l.id })">▶</button>
          <button type="button" class="btn ghost" title="remove" @click="post({ action: 'delete', id: l.id })">✕</button>
        </li>
      </ul>
    </Panel>

    <LearnSkills :skills="skills" :updating="lessons.some(l => l.skills === 'writing' || l.skills === 'pending')" @post="post" />

    <!-- the library -->
    <h2 class="sec">Library <span class="muted small">{{ ready.length }} lessons</span></h2>
    <div v-if="ready.length" class="filters">
      <input v-model="q" class="search" type="search" placeholder="Search" enterkeyhint="search">
      <select v-model="show">
        <option value="all">All</option>
        <option value="open">Not finished</option>
        <option value="done">Finished</option>
      </select>
    </div>
    <div v-if="tracks.length > 1" class="tracks">
      <button v-for="[t, n] in tracks" :key="t" type="button" class="chip" :class="{ on: track === t }" @click="track = track === t ? '' : t">
        {{ trackIcon(t) }} {{ t }} <span class="faint">{{ n }}</span>
      </button>
    </div>
    <div class="lib">
      <button v-for="l in library" :key="l.id" type="button" class="item" @click="open(l.id)">
        <span class="ic">{{ trackIcon(l.lesson.track) }}</span>
        <span class="txt">
          <b>{{ l.lesson.title }}</b>
          <span class="muted small">{{ l.lesson.summary }}</span>
          <span class="faint small">
            {{ l.day }} · {{ l.lesson.level }}
            <template v-if="quizScore(l).answered"> · quiz {{ quizScore(l).right }}/{{ quizScore(l).total }}</template>
          </span>
        </span>
        <span v-if="l.done" class="ok done">✓</span>
        <span v-else-if="lessonProgress(l).done" class="faint small">{{ lessonProgress(l).pct }}%</span>
      </button>
      <p v-if="loaded && !ready.length" class="faint small">Nothing yet.</p>
      <p v-else-if="ready.length && !library.length" class="faint small">Nothing matches.</p>
    </div>

    <template v-if="failed.length">
      <h2 class="sec">Failed <span class="muted small">{{ failed.length }}</span></h2>
      <ul class="queue">
        <li v-for="l in failed" :key="l.id">
          <span class="bad small">✕</span> {{ l.topic || 'Claude’s pick' }} <span class="faint small err">{{ l.error }}</span>
          <span class="sp" />
          <button type="button" class="btn ghost" @click="post({ action: 'write', id: l.id })">Retry</button>
          <button type="button" class="btn ghost" @click="post({ action: 'delete', id: l.id })">✕</button>
        </li>
      </ul>
    </template>

    <LearnLesson v-if="current" :key="current.id" :item="current" @close="close" @post="post" @queue="t => post({ action: 'queue', topic: t })" />
  </div>
</template>

<style scoped>
.learn { max-width: 860px; margin: 0 auto; }
.errbox { margin: 0 0 12px; }
.label { margin-bottom: 6px; text-transform: uppercase; letter-spacing: .06em; }
.hero { background: linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--panel); border: 1px solid var(--line-2); border-radius: var(--radius); padding: 18px 20px; cursor: pointer; display: flex; flex-direction: column; gap: 8px; }
.hero:hover { border-color: var(--accent); }
.hero.wait { cursor: default; flex-direction: row; align-items: center; gap: 14px; flex-wrap: wrap; }
.hero.wait:hover { border-color: var(--line-2); }
.hero.wait > div { flex: 1; min-width: 200px; }
.hero.wait .muted { overflow-wrap: anywhere; }
.pills { display: flex; flex-wrap: wrap; gap: 6px; }
.hero h1 { margin: 0; font-size: 22px; line-height: 1.25; font-weight: 650; }
.hero p { margin: 0; font-size: 14.5px; }
.bar { height: 4px; border-radius: 4px; background: var(--track); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); }
.go { align-self: flex-start; margin-top: 4px; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
.stats > div { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 14px; display: flex; flex-direction: column; }
.stats b { font-size: 20px; font-weight: 650; }
.stats small { font-size: 13px; color: var(--faint); font-weight: 400; }
.stats span { font-size: 12px; color: var(--muted); }
.ask { display: flex; gap: 8px; flex-wrap: wrap; }
.ask input { flex: 1; min-width: 200px; padding: 8px 12px; }
.btns { display: flex; gap: 6px; }
.queue { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; }
.queue li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); min-width: 0; }
.queue .btn { padding: 4px 8px; }
.err { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sp { flex: 1; }
.filters { display: flex; gap: 8px; margin-bottom: 8px; }
.filters .search { flex: 1; min-width: 0; padding: 7px 12px; }
.filters select { flex: none; width: auto; padding: 6px 8px; }
.tracks { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.lib { display: flex; flex-direction: column; gap: 6px; }
.item { display: flex; align-items: center; gap: 12px; text-align: left; font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 14px; cursor: pointer; }
.item:hover { border-color: var(--line-2); background: var(--panel-2); }
.ic { font-size: 20px; flex: none; }
.txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.txt b { font-weight: 600; }
.done { font-size: 16px; }
.spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line-2); border-top-color: var(--accent); animation: spin 1s linear infinite; flex: none; }
.spin.sm { width: 12px; height: 12px; }
@keyframes spin { to { transform: rotate(360deg) } }
@media (max-width: 640px) {
  .hero { padding: 16px; }
  .hero h1 { font-size: 20px; }
  .btns { flex: 1; }
  .btns .btn { flex: 1; }
  .stats b { font-size: 18px; }
}
</style>
