<script setup lang="ts">
useHead({ title: 'Kanji · pve' })

const o = ref<any>(null)
const error = ref('')
async function load() {
  try { o.value = await $fetch<any>('/api/kanji'); error.value = '' } catch (e: any) { error.value = e?.statusMessage || e?.message }
}
usePoll(load, 60_000)
const deck = useKanjiDeck()

// study screen and info sheet live in the URL, so the phone's back button closes them
const route = useRoute(), router = useRouter()
const studying = computed(() => route.query.study === '1' && !!o.value)
const infoK = computed(() => (typeof route.query.k === 'string' ? route.query.k : ''))
const go = (q: Record<string, any>) => router.push({ query: { ...route.query, ...q } })
function back(key: string) { if (window.history.state?.back) router.back(); else router.replace({ query: { ...route.query, [key]: undefined } }) }
function closeStudy() { back('study'); load() }

const due = computed(() => (o.value ? o.value.next.new + o.value.next.learn + o.value.next.review : 0))
const nextUp = computed(() => o.value?.forecast?.[1] ?? 0)

// --- heatmap: the last 26 weeks, Monday-first columns ---
const heat = computed(() => {
  if (!o.value) return []
  const today = Date.parse(`${o.value.day}T12:00:00Z`)
  const wd = (new Date(today).getUTCDay() + 6) % 7
  const start = today - (25 * 7 + wd) * 86_400_000
  const cells: { d: string, n: number, l: number }[] = []
  for (let t = start; t <= today; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10), n = o.value.heat[d] ?? 0
    cells.push({ d, n, l: !n ? 0 : n < 15 ? 1 : n < 40 ? 2 : n < 80 ? 3 : 4 })
  }
  return cells
})
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmax = computed(() => Math.max(1, ...(o.value?.forecast ?? [])))

// --- browse ---
const lvl = ref<number>(5)
const q = ref('')
const shown = computed(() => {
  const d = deck.value ?? []
  const s = q.value.trim().toLowerCase()
  if (!s) return d.filter(x => x.n === lvl.value)
  const ks = s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
  return d.filter(x => x.k === s || x.m.some(m => m.toLowerCase().includes(s))
    || [...x.on, ...x.kun].some(r => r.replace(/[.-]/g, '').startsWith(ks))).slice(0, 300)
})
const st = (k: string) => o.value?.status?.[k] ?? 0

// --- settings ---
async function settings(body: Record<string, any>) {
  try { await $fetch('/api/kanji/action', { method: 'POST', body: { action: 'settings', ...body } }); load() } catch (e: any) { error.value = e?.data?.statusMessage || e?.message }
}
function toggleLevel(n: number) {
  const l = o.value.settings.levels as number[]
  const next = l.includes(n) ? l.filter(x => x !== n) : [...l, n]
  if (next.length) settings({ levels: next })
}
</script>

<template>
  <div class="kj">
    <p v-if="error" class="errbox">{{ error }}</p>
    <div v-if="!o" class="muted small">Loading…</div>
    <template v-else>
      <section class="hero">
        <div class="counts">
          <div><b class="c-new">{{ o.next.new }}</b><span>new</span></div>
          <div><b class="c-learn">{{ o.next.learn }}</b><span>learning</span></div>
          <div><b class="c-rev">{{ o.next.review }}</b><span>to review</span></div>
        </div>
        <button v-if="due" type="button" class="btn primary go" @click="go({ study: '1' })">Study now</button>
        <div v-else class="muted small doneline">🎉 Done for today<template v-if="nextUp"> · {{ nextUp }} due tomorrow</template></div>
      </section>

      <div class="stats">
        <div><b>{{ o.streak }}</b><span>🔥 days</span></div>
        <div><b>{{ o.today.reviews }}</b><span>today{{ o.today.mins ? ` · ${o.today.mins} min` : '' }}</span></div>
        <div><b>{{ o.retention == null ? '–' : `${o.retention}%` }}</b><span>retention</span></div>
        <div><b>{{ o.total.seen }}</b><span>{{ o.total.mature }} mature · ✍️ {{ o.total.written }}</span></div>
      </div>

      <Panel title="JLPT progress" id="kanji-levels">
        <div class="levels">
          <div v-for="l in o.levels" :key="l.n" class="lv">
            <span class="name">N{{ l.n }}</span>
            <div class="bar" :title="`${l.seen} seen, ${l.mature} mature of ${l.total}`">
              <i class="seen" :style="{ width: `${(100 * l.seen) / l.total}%` }" />
              <i class="mat" :style="{ width: `${(100 * l.mature) / l.total}%` }" />
            </div>
            <span class="num small muted">{{ l.seen }}<span class="faint">/{{ l.total }}</span></span>
          </div>
        </div>
        <div class="legend faint small"><i class="sw seen" /> seen <i class="sw mat" /> mature (21 d+)</div>
      </Panel>

      <div class="grid cols-2 two">
        <Panel title="Activity" id="kanji-heat" sub="26 weeks">
          <div class="scroll-x">
            <div class="heat">
              <i v-for="c in heat" :key="c.d" :class="`l${c.l}`" :title="`${fmtDay(c.d)}: ${c.n}`" />
            </div>
          </div>
          <div class="faint small">{{ o.total.reviews }} reviews in all</div>
        </Panel>
        <Panel title="Coming up" id="kanji-forecast" sub="reviews, 14 days">
          <div class="fc">
            <div v-for="(n, i) in o.forecast" :key="i" class="col" :title="`${n}`">
              <span class="faint">{{ n || '' }}</span>
              <i :style="{ height: `${(100 * n) / fmax}%` }" :class="{ today: i === 0 }" />
            </div>
          </div>
          <div class="faint small">today → in 2 weeks</div>
        </Panel>
      </div>

      <h2 class="sec">Browse <span class="muted small">{{ deck ? deck.length : '…' }} kanji</span></h2>
      <div class="filters">
        <input v-model="q" class="search" type="search" placeholder="Kanji, meaning or reading" enterkeyhint="search">
      </div>
      <div v-if="!q.trim()" class="chips">
        <button v-for="n in LEVELS" :key="n" type="button" class="chip" :class="{ on: lvl === n }" @click="lvl = n">N{{ n }}</button>
      </div>
      <div v-if="deck" class="kgrid">
        <button v-for="x in shown" :key="x.k" type="button" lang="ja" :class="`s${st(x.k)}`" :title="x.m.join(', ')" @click="go({ k: x.k })">{{ x.k }}</button>
      </div>
      <p v-else class="muted small">Loading…</p>
      <p v-if="deck && !shown.length" class="faint small">Nothing matches.</p>
      <div class="legend faint small"><i class="sw s0" /> new <i class="sw s1" /> learning <i class="sw s2" /> young <i class="sw s3" /> mature</div>

      <Panel title="Settings" id="kanji-settings" fold="closed">
        <div class="set">
          <span class="muted small">New cards a day</span>
          <div class="seg">
            <button v-for="n in [0, 5, 10, 15, 20, 30]" :key="n" type="button" :class="{ on: o.settings.newPerDay === n }" @click="settings({ newPerDay: n })">{{ n }}</button>
          </div>
        </div>
        <div class="set">
          <span class="muted small">Writing cards</span>
          <div class="seg">
            <button type="button" :class="{ on: o.settings.writing }" @click="settings({ writing: true })">On</button>
            <button type="button" :class="{ on: !o.settings.writing }" @click="settings({ writing: false })">Off</button>
          </div>
        </div>
        <div class="set">
          <span class="muted small">New cards from</span>
          <div class="chips">
            <button v-for="n in LEVELS" :key="n" type="button" class="chip" :class="{ on: o.settings.levels.includes(n) }" @click="toggleLevel(n)">N{{ n }}</button>
          </div>
        </div>
        <p class="faint small">Kanji data: KANJIDIC2 + JMdict (EDRDG), stroke order: KanjiVG.</p>
      </Panel>
    </template>

    <KanjiStudy v-if="studying" :start="o.next" @close="closeStudy" />
    <KanjiInfo v-if="infoK" :k="infoK" @close="back('k')" @changed="load" />
  </div>
</template>

<style scoped>
.kj { max-width: 860px; margin: 0 auto; }
.errbox { margin: 0 0 12px; }
.hero { background: linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--panel); border: 1px solid var(--line-2); border-radius: var(--radius); padding: 16px 18px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.counts { display: flex; gap: 22px; flex: 1; }
.counts > div { display: flex; flex-direction: column; }
.counts b { font-size: 26px; font-weight: 650; line-height: 1.1; }
.counts span { font-size: 12px; color: var(--muted); }
.c-new { color: var(--accent); } .c-learn { color: var(--bad); } .c-rev { color: var(--ok); }
.go { min-height: 44px; padding: 0 22px; font-size: 15px; }
.doneline { font-size: 13px; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
.stats > div { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 14px; display: flex; flex-direction: column; min-width: 0; }
.stats b { font-size: 20px; font-weight: 650; }
.stats span { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.levels { display: flex; flex-direction: column; gap: 8px; }
.lv { display: grid; grid-template-columns: 30px 1fr 74px; gap: 10px; align-items: center; }
.name { font-weight: 600; font-size: 13px; }
.bar { position: relative; height: 8px; border-radius: 8px; background: var(--track); overflow: hidden; }
.bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 8px; }
.seen { background: var(--accent); opacity: .45; }
.mat { background: var(--ok); }
.num { text-align: right; }
.legend { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-left: 4px; }
.sw.seen { opacity: .6; }
.two { margin: 14px 0 0; }
.heat { display: grid; grid-template-rows: repeat(7, 11px); grid-auto-flow: column; grid-auto-columns: 11px; gap: 3px; margin-bottom: 8px; width: max-content; }
.heat i { border-radius: 2px; background: var(--track); }
.heat .l1 { background: var(--ok); opacity: .3; } .heat .l2 { background: var(--ok); opacity: .55; }
.heat .l3 { background: var(--ok); opacity: .8; } .heat .l4 { background: var(--ok); }
.fc { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 3px; height: 90px; align-items: end; margin-bottom: 8px; }
.col { display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; font-size: 10px; gap: 2px; }
.col i { width: 100%; min-height: 2px; background: var(--ok); opacity: .7; border-radius: 3px 3px 0 0; }
.col i.today { opacity: 1; }
.filters { display: flex; gap: 8px; margin-bottom: 8px; }
.search { flex: 1; min-width: 0; padding: 7px 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.kgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 5px; }
.kgrid button { aspect-ratio: 1; font: inherit; font-size: 22px; border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--panel); color: var(--faint); cursor: pointer; padding: 0; }
.kgrid button:hover { border-color: var(--line-2); }
.s1 { color: var(--warn) !important; background: var(--warn-soft) !important; border-color: transparent !important; }
.s2 { color: var(--accent) !important; background: var(--accent-soft) !important; border-color: transparent !important; }
.s3 { color: var(--ok) !important; background: var(--ok-soft) !important; border-color: transparent !important; }
.sw.s0 { background: var(--panel-2); border: 1px solid var(--line-2); }
.sw.s1 { background: var(--warn); } .sw.s2 { background: var(--accent); } .sw.s3 { background: var(--ok); }
.set { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.set .chips { margin: 0; }
.set > span { min-width: 120px; }
@media (max-width: 640px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .go { width: 100%; }
  .counts { justify-content: space-around; }
}
</style>
