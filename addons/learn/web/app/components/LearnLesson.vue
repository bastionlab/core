<script setup lang="ts">
/**
 * one lesson, full screen, as steps: overview → each reading section → each quiz question → each task → recap.
 * One thing per screen with Back / Next under the thumb works far better on a phone than one 6,000-word scroll
 * (2026-10-24). Every tick is saved, and the step is remembered per lesson, so it can be done in pieces.
 */
const props = defineProps<{ item: any }>()
const emit = defineEmits<{ close: [], post: [Record<string, any>], queue: [string] }>()

const l = computed(() => props.item)
const x = computed(() => l.value.lesson)
const p = computed(() => l.value.progress ?? {})
const score = computed(() => quizScore(l.value))
const minutes = computed(() => [...x.value.sections, ...x.value.tasks].reduce((s: number, v: any) => s + (v.minutes || 0), 0) + Math.round(x.value.quiz.length * 1.2))

type Step = { kind: 'intro' | 'read' | 'quiz' | 'task' | 'recap', i: number }
const steps = computed<Step[]>(() => [
  { kind: 'intro', i: 0 },
  ...x.value.sections.map((_: any, i: number) => ({ kind: 'read', i })),
  ...x.value.quiz.map((_: any, i: number) => ({ kind: 'quiz', i })),
  ...x.value.tasks.map((_: any, i: number) => ({ kind: 'task', i })),
  { kind: 'recap', i: 0 },
] as Step[])

const read = (i: number) => (p.value.read ?? []).includes(i)
const answered = (i: number) => p.value.quiz?.[i] != null
const taskDone = (i: number) => (p.value.tasks ?? []).includes(i)
const isDone = (s: Step) => s.kind === 'read' ? read(s.i) : s.kind === 'quiz' ? answered(s.i) : s.kind === 'task' ? taskDone(s.i)
  : s.kind === 'recap' ? !!l.value.done : stepAt.value > 0 || (p.value.read ?? []).length > 0

// where the owner left off, per lesson and browser
const KEY = `learn:step:${props.item.id}`
const stepAt = ref(0)
try { stepAt.value = Math.min(Number(localStorage.getItem(KEY)) || 0, steps.value.length - 1) } catch {}
const step = computed(() => steps.value[stepAt.value]!)
const body = ref<HTMLElement>()
function go(n: number) {
  stepAt.value = Math.max(0, Math.min(n, steps.value.length - 1))
  try { localStorage.setItem(KEY, String(stepAt.value)) } catch {}
  solution.value = false
  body.value?.scrollTo({ top: 0 })
}

const flip = (list: number[] = [], i: number, on: boolean) => (on ? [...new Set([...list, i])].sort((a, b) => a - b) : list.filter(v => v !== i))
const save = (f: Record<string, any>) => emit('post', { action: 'progress', id: l.value.id, ...f })
function next() {
  const s = step.value
  // "Next" on a reading section is the "got it"
  if (s.kind === 'read' && !read(s.i)) save({ read: flip(p.value.read, s.i, true) })
  go(stepAt.value + 1)
}
const answer = (qi: number, oi: number) => { if (!answered(qi)) save({ quiz: { ...p.value.quiz, [qi]: oi } }) }
const toggleTask = (i: number) => save({ tasks: flip(p.value.tasks, i, !taskDone(i)) })
function retake() {
  save({ quiz: {} })
  go(steps.value.findIndex(s => s.kind === 'quiz'))
}
const solution = ref(false)

const label = computed(() => {
  const s = step.value
  return s.kind === 'intro' ? 'Overview'
    : s.kind === 'read' ? `Read ${s.i + 1} of ${x.value.sections.length}`
      : s.kind === 'quiz' ? `Question ${s.i + 1} of ${x.value.quiz.length}`
        : s.kind === 'task' ? `Task ${s.i + 1} of ${x.value.tasks.length}` : 'Recap'
})
const nextLabel = computed(() => {
  const s = step.value, after = steps.value[stepAt.value + 1]
  if (s.kind === 'read' && !read(s.i)) return '✓ Got it'
  if (s.kind === 'quiz' && !answered(s.i)) return 'Skip'
  if (s.kind === 'intro') return 'Start reading'
  return after?.kind === 'quiz' && s.kind !== 'quiz' ? 'To the quiz' : after?.kind === 'task' && s.kind !== 'task' ? 'To the tasks' : after?.kind === 'recap' ? 'To the recap' : 'Next'
})

const { armed, arm } = useArm()
function del() { if (arm('del')) emit('post', { action: 'delete', id: l.value.id }) }
const queued = ref<string[]>([])
function queue(t: string) { if (!queued.value.includes(t)) { queued.value.push(t); emit('queue', t) } }
function finish() { emit('post', { action: 'done', id: l.value.id, done: true }); emit('close') }

const onKey = (e: KeyboardEvent) => {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowRight' && step.value.kind !== 'recap') next()
  else if (e.key === 'ArrowLeft') go(stepAt.value - 1)
}
onMounted(() => { window.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden' })
onUnmounted(() => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' })
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <article class="sheet">
      <!-- slim, always visible: close, where am I, tap a segment to jump -->
      <header>
        <div class="top">
          <button type="button" class="btn ghost x" title="close (Esc)" @click="emit('close')">✕</button>
          <div class="where">
            <b>{{ x.title }}</b>
            <span class="faint small">{{ label }}</span>
          </div>
          <span class="faint small n">{{ stepAt + 1 }}/{{ steps.length }}</span>
        </div>
        <div class="segs">
          <button
            v-for="(s, i) in steps" :key="i" type="button" class="sg" :class="[s.kind, { done: isDone(s), here: i === stepAt, gap: i > 0 && steps[i - 1]!.kind !== s.kind, wrong: s.kind === 'quiz' && answered(s.i) && p.quiz[s.i] !== x.quiz[s.i].answer }]"
            :aria-label="`step ${i + 1}`" @click="go(i)"
          />
        </div>
      </header>

      <div ref="body" class="content">
        <!-- overview -->
        <template v-if="step.kind === 'intro'">
          <div class="meta">
            <span class="pill accent">{{ trackIcon(x.track) }} {{ x.track }}</span>
            <span class="pill">{{ x.level }}</span>
            <span class="pill">~{{ minutes }} min</span>
          </div>
          <h1>{{ x.title }}</h1>
          <p class="why">{{ x.why }}</p>
          <h4>After this hour</h4>
          <ul class="obj"><li v-for="o in x.objectives" :key="o">{{ o }}</li></ul>
          <h4>The plan</h4>
          <ol class="plan">
            <li v-for="(s, i) in x.sections" :key="i" :class="{ ok: read(i) }" @click="go(1 + i)">
              <span>{{ s.title }}</span><span class="faint">{{ read(i) ? '✓' : `${s.minutes} min` }}</span>
            </li>
            <li @click="go(1 + x.sections.length)"><span>❓ Quiz · {{ x.quiz.length }} questions</span><span class="faint">{{ score.answered ? `${score.right}/${score.total}` : '' }}</span></li>
            <li @click="go(1 + x.sections.length + x.quiz.length)"><span>🛠 {{ x.tasks.length }} hands-on tasks</span><span class="faint">{{ (p.tasks ?? []).length ? `${p.tasks.length} done` : '' }}</span></li>
          </ol>
        </template>

        <!-- one reading section -->
        <template v-else-if="step.kind === 'read'">
          <div class="kicker faint small">📖 {{ x.sections[step.i].minutes }} min read</div>
          <h2>{{ x.sections[step.i].title }}</h2>
          <div class="md body" v-html="md(x.sections[step.i].body)" />
        </template>

        <!-- one question -->
        <template v-else-if="step.kind === 'quiz'">
          <div class="kicker faint small">❓ {{ score.right }} right so far</div>
          <div class="md q" v-html="md(x.quiz[step.i].q)" />
          <div class="opts">
            <button
              v-for="(o, oi) in x.quiz[step.i].options" :key="oi" type="button" class="opt"
              :class="{ right: answered(step.i) && oi === x.quiz[step.i].answer, wrong: p.quiz?.[step.i] === oi && oi !== x.quiz[step.i].answer, dim: answered(step.i) && oi !== x.quiz[step.i].answer && p.quiz?.[step.i] !== oi }"
              :disabled="answered(step.i)" @click="answer(step.i, oi)"
            >
              <span class="letter">{{ 'ABCDEF'[oi] }}</span><span class="md" v-html="md(o)" />
            </button>
          </div>
          <div v-if="answered(step.i)" class="explain" :class="p.quiz[step.i] === x.quiz[step.i].answer ? 'ok' : 'bad'">
            <b>{{ p.quiz[step.i] === x.quiz[step.i].answer ? '✓ Right.' : '✕ Not quite.' }}</b>
            <div class="md" v-html="md(x.quiz[step.i].why)" />
          </div>
        </template>

        <!-- one task -->
        <template v-else-if="step.kind === 'task'">
          <div class="kicker faint small">🛠 {{ x.tasks[step.i].minutes }} min hands-on</div>
          <h2>{{ x.tasks[step.i].title }}</h2>
          <div class="md body" v-html="md(x.tasks[step.i].body)" />
          <button type="button" class="btn wide" :class="{ on: solution }" @click="solution = !solution">{{ solution ? 'Hide' : 'Show' }} the solution</button>
          <div v-if="solution" class="md body sol" v-html="md(x.tasks[step.i].solution)" />
          <label class="check"><input type="checkbox" :checked="taskDone(step.i)" @change="toggleTask(step.i)"> I did this one</label>
        </template>

        <!-- recap -->
        <template v-else>
          <h2>Recap</h2>
          <div class="score">
            <div><b>{{ (p.read ?? []).length }}/{{ x.sections.length }}</b><span>sections read</span></div>
            <div><b>{{ score.right }}/{{ score.total }}</b><span>quiz right</span></div>
            <div><b>{{ (p.tasks ?? []).length }}/{{ x.tasks.length }}</b><span>tasks done</span></div>
          </div>
          <ul class="recap"><li v-for="r in x.recap" :key="r" class="md" v-html="md(r)" /></ul>
          <template v-if="x.resources?.length">
            <h4>Go deeper</h4>
            <ul class="res"><li v-for="r in x.resources" :key="r.url"><a :href="r.url" target="_blank" rel="noopener">{{ r.title }}</a></li></ul>
          </template>
          <template v-if="x.next?.length">
            <h4>Learn next? Tap to queue</h4>
            <div class="chips">
              <button v-for="t in x.next" :key="t" type="button" class="chip" :disabled="queued.includes(t)" @click="queue(t)">
                {{ queued.includes(t) ? '✓' : '+' }} {{ t }}
              </button>
            </div>
          </template>
          <div class="minor">
            <button v-if="score.answered" type="button" class="btn ghost" @click="retake">↺ Retake the quiz</button>
            <button type="button" class="btn ghost danger" :class="{ sure: armed === 'del' }" @click="del">{{ armed === 'del' ? 'Sure?' : 'Delete lesson' }}</button>
          </div>
        </template>
      </div>

      <footer>
        <button type="button" class="btn back" :disabled="stepAt === 0" aria-label="back" @click="go(stepAt - 1)">←</button>
        <button v-if="step.kind !== 'recap'" type="button" class="btn go" :class="{ primary: !(step.kind === 'quiz' && !answered(step.i)) }" @click="next">{{ nextLabel }} →</button>
        <button v-else-if="!l.done" type="button" class="btn primary go" @click="finish">🎓 Finish lesson</button>
        <button v-else type="button" class="btn go" @click="emit('post', { action: 'done', id: l.id, done: false })">✓ Finished · undo</button>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, .55); display: flex; justify-content: center; align-items: center; padding: 3vh 16px; }
.sheet { width: 100%; max-width: 760px; height: 100%; max-height: 940px; background: var(--panel); border: 1px solid var(--line-2); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
header { flex: none; padding: 8px 12px 8px; border-bottom: 1px solid var(--line); }
.top { display: flex; align-items: center; gap: 6px; }
.x { font-size: 16px; width: 36px; height: 36px; padding: 0; flex: none; }
.where { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.where b { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.n { flex: none; padding-right: 4px; }
.segs { display: flex; gap: 2px; margin-top: 8px; }
.sg { flex: 1; height: 6px; min-width: 0; padding: 0; border: 0; border-radius: 3px; background: var(--track); cursor: pointer; position: relative; }
/* a fat invisible hit area: the bar itself is thin. Not .seg: that is the global segmented control */
.sg::after { content: ''; position: absolute; inset: -9px 0; }
.sg.gap { margin-left: 5px; }
.sg.done { background: color-mix(in srgb, var(--accent) 55%, var(--track)); }
.sg.quiz.done { background: color-mix(in srgb, var(--ok) 55%, var(--track)); }
.sg.quiz.wrong { background: color-mix(in srgb, var(--bad) 60%, var(--track)); }
.sg.here { background: var(--text); }
.content { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 18px 22px 28px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px; }
h1 { margin: 12px 0 8px; font-size: 23px; line-height: 1.25; font-weight: 650; }
h2 { margin: 4px 0 12px; font-size: 20px; line-height: 1.3; font-weight: 650; }
h4 { margin: 18px 0 6px; font-size: 12px; color: var(--faint); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.kicker { margin-bottom: 4px; }
.why { margin: 0; color: var(--muted); font-size: 15.5px; line-height: 1.55; }
.obj { margin: 0; padding-left: 20px; line-height: 1.5; }
.obj li + li { margin-top: 4px; }
.plan { margin: 0; padding: 0; list-style: none; counter-reset: s; }
.plan li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); cursor: pointer; }
.plan li.ok > span:first-child { color: var(--muted); }
.body { font-size: 15.5px; line-height: 1.7; }
.body :deep(pre) { font-size: 12.5px; line-height: 1.5; margin: 10px -4px; }
.body :deep(h3) { font-size: 15.5px; margin-top: 18px; }
.body :deep(table) { display: block; overflow-x: auto; font-size: 13px; margin: 0 0 10px; }
.body :deep(td), .body :deep(th) { padding: 6px 8px; }
.q { font-size: 17px; line-height: 1.5; margin-bottom: 14px; }
.opts { display: flex; flex-direction: column; gap: 8px; }
.opt { display: flex; gap: 10px; align-items: baseline; text-align: left; font: inherit; font-size: 15px; line-height: 1.45; color: var(--text); background: var(--panel-2); border: 1px solid var(--line-2); border-radius: var(--radius-sm); padding: 12px 14px; cursor: pointer; }
.opt:hover:not(:disabled) { border-color: var(--accent); }
.opt:disabled { cursor: default; }
.letter { flex: none; font-weight: 700; color: var(--faint); font-size: 13px; }
.opt.right { border-color: var(--ok); background: var(--ok-soft); }
.opt.right .letter { color: var(--ok); }
.opt.wrong { border-color: var(--bad); background: var(--bad-soft); }
.opt.wrong .letter { color: var(--bad); }
.opt.dim { opacity: .45; }
.explain { margin-top: 14px; font-size: 14.5px; line-height: 1.55; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--panel-2); }
.explain .md { color: var(--text); margin-top: 4px; }
.btn.wide { width: 100%; margin: 6px 0 4px; min-height: 42px; }
.btn.on { color: var(--accent); border-color: var(--accent); }
.sol { border-left: 2px solid var(--ok); padding-left: 12px; margin-top: 10px; }
.check { display: flex; align-items: center; gap: 10px; margin-top: 16px; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: var(--radius-sm); cursor: pointer; font-size: 15px; }
.check input { width: 20px; height: 20px; }
.score { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.score > div { background: var(--panel-2); border-radius: var(--radius-sm); padding: 10px 12px; display: flex; flex-direction: column; }
.score b { font-size: 18px; }
.score span { font-size: 12px; color: var(--muted); }
.recap { margin: 0; padding-left: 20px; font-size: 15px; line-height: 1.55; }
.recap li + li { margin-top: 6px; }
.res { margin: 0; padding-left: 20px; line-height: 1.8; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { white-space: normal; text-align: left; color: var(--text); }
.chip:disabled { color: var(--ok); cursor: default; }
.minor { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 26px; padding-top: 12px; border-top: 1px solid var(--line); }
footer { flex: none; display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); background: var(--panel); }
footer .btn { min-height: 46px; font-size: 15px; border-radius: var(--radius-sm); }
.back { width: 56px; flex: none; font-size: 18px; }
.go { flex: 1; }
@media (max-width: 640px) {
  .scrim { padding: 0; }
  .sheet { max-height: none; border-radius: 0; border: 0; }
  header { padding-top: calc(6px + env(safe-area-inset-top)); }
  .content { padding: 16px 16px 24px; }
  footer { padding-bottom: calc(10px + env(safe-area-inset-bottom)); }
  .body { font-size: 16px; }
}
</style>
