<script setup lang="ts">
useHead({ title: 'Money · pve' })
const route = useRoute()
const router = useRouter()

// everything you navigate to lives in the URL (?t=tab&m=month&d=day&c=category), so back/forward and reloads keep your place
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '')
const setQ = (patch: Record<string, string | undefined>, push = false) => {
  const query: Record<string, any> = { ...route.query, ...patch }
  for (const k in query) if (!query[k]) delete query[k]
  ;(push ? router.push : router.replace)({ query })
}
const TABS = [['monat', 'Monat'], ['buchungen', 'Buchungen'], ['abos', 'Abos'], ['depot', 'Depot'], ['konten', 'Konten']] as const
const tab = computed(() => q('t') || 'monat')
const goTab = (t: string, extra: Record<string, string | undefined> = {}) => { setQ({ t: t === 'monat' ? undefined : t, ...extra }, true); window.scrollTo({ top: 0 }) }

const thisMonth = isoMonth()
const month = computed(() => (/^\d{4}-\d{2}$/.test(q('m')) ? q('m') : thisMonth))
const setMonth = (m: string) => setQ({ m: m === thisMonth ? undefined : m, d: undefined })
function shift(n: number) {
  const [y, m] = month.value.split('-').map(Number) as [number, number]
  setMonth(isoMonth(new Date(y, m - 1 + n, 1)))
}
function today() { setQ({ m: undefined, d: tab.value === 'monat' ? isoDay() : undefined }) }
const isNow = computed(() => month.value >= thisMonth)
const day = computed(() => (q('d').startsWith(month.value) ? q('d') : ''))
const cat = computed(() => q('c'))

const d = ref<any>(null)
const error = ref<any>(null)
const pending = ref(false)
async function load() {
  pending.value = true
  try { d.value = await $fetch('/api/money', { query: { month: month.value } }); error.value = null }
  catch (e: any) { error.value = e } finally { pending.value = false }
}
// fast while a sync or TR login is running, otherwise lazy
const fast = computed(() => d.value?.syncing || ['waiting_app', 'need_code'].includes(d.value?.setup?.tr_login?.state))
usePoll(load, 30000)
let t: any
watch(fast, f => { clearInterval(t); if (f) t = setInterval(load, 3000) })
onUnmounted(() => clearInterval(t))
watch(month, load)

// back from the bank login: ?code=…&state=…
const linkMsg = ref('')
onMounted(async () => {
  const { code, state, error: e, error_description: ed } = route.query as any
  if (!code && !e) return
  router.replace('/money')
  if (e) { linkMsg.value = `Bank-Login abgebrochen: ${ed || e}`; return }
  linkMsg.value = 'Verbinde…'
  try {
    const r: any = await $fetch('/api/money/action', { method: 'POST', body: { action: 'ebFinish', code, state } })
    linkMsg.value = `✓ ${r.aspsp} verbunden: ${r.accounts.join(', ') || 'keine Konten freigegeben'} – erster Import läuft.`
  } catch (x: any) { linkMsg.value = `Verbinden fehlgeschlagen: ${x?.data?.statusMessage || x?.message}` }
  load()
})

const toast = ref('')
async function act(action: string, body: Record<string, any> = {}) {
  try { await $fetch('/api/money/action', { method: 'POST', body: { action, ...body } }) }
  catch (e: any) { toast.value = e?.data?.statusMessage || e?.message; setTimeout(() => (toast.value = ''), 4000) }
  finally { load() }
}

const L = computed(() => d.value?.ledger)
const monthShort = (m: string) => new Date(m + '-01T12:00').toLocaleDateString('de-DE', { month: 'short' })
const catMax = computed(() => Math.max(1, ...(L.value?.categories ?? []).flatMap((c: any) => [c.amount, c.avg ?? 0])))
const trendMax = computed(() => Math.max(1, ...(L.value?.trend ?? []).flatMap((t: any) => [t.income, t.spending])))
const vsAvg = computed(() => (L.value?.avg_spending ? L.value.spending - L.value.avg_spending : null))

const pf = computed(() => d.value?.portfolio)
const depotIn = computed(() => (pf.value?.positions ?? []).reduce((a: number, p: any) => a + (p.buyin || 0), 0))
const gain = computed(() => (pf.value?.positions?.length ? d.value.invested_value - depotIn.value : null))
const trCash = computed(() => d.value?.accounts?.find((a: any) => a.key === 'tr:cash')?.balance ?? null)
const activeSubs = computed(() => (d.value?.subs ?? []).filter((s: any) => s.state === 'active'))
const nextDue = computed(() => {
  const end = new Date(); end.setDate(end.getDate() + 7)
  return activeSubs.value.flatMap((s: any) => subCharges(s, isoDay(end)).filter(x => x >= isoDay())).length
})

// ---- bookings: month list or a search across all history, filters, grouped by day
const search = ref(q('q'))
const found = ref<any[] | null>(null)
const searching = ref(false)
let st: any
watch(search, (v) => {
  clearTimeout(st)
  if (v.trim() !== q('q')) setQ({ q: v.trim() || undefined })
  if (v.trim().length < 2) { found.value = null; return }
  st = setTimeout(async () => {
    searching.value = true
    try { found.value = (await $fetch<any>('/api/money/search', { query: { q: v.trim() } })).transactions } catch { found.value = [] } finally { searching.value = false }
  }, 300)
}, { immediate: true })
const kind = computed(() => q('k'))  // '' | out | in
const acct = computed(() => q('a'))
const accounts = computed(() => [...new Set((L.value?.transactions ?? []).map((t: any) => t.account))].sort())
const txAll = computed<any[]>(() => found.value ?? L.value?.transactions ?? [])
const txShown = computed(() => txAll.value.filter((t: any) =>
  (!cat.value || t.category === cat.value) && (found.value || !day.value || t.date === day.value) &&
  (!kind.value || (kind.value === 'in' ? t.amount > 0 : t.amount < 0)) && (!acct.value || t.account === acct.value)))
const LIMIT = ref(200)
watch([txAll, cat, day, kind, acct], () => (LIMIT.value = 200))
const groups = computed(() => {
  const out: { day: string, sum: number, txs: any[] }[] = []
  for (const t of txShown.value.slice(0, LIMIT.value)) {
    let g = out.at(-1)
    if (!g || g.day !== t.date) out.push(g = { day: t.date, sum: 0, txs: [] })
    g.txs.push(t)
    if (!['Umbuchung', 'Investments'].includes(t.category)) g.sum += t.amount
  }
  return out
})
const shownSum = computed(() => txShown.value.filter((t: any) => !['Umbuchung', 'Investments'].includes(t.category)).reduce((a: number, t: any) => a + t.amount, 0))

// select mode: tick bookings, then make them one subscription or recategorize them together
const selecting = ref(false)
const sel = ref<Set<string>>(new Set())
const selTx = computed(() => txAll.value.filter((t: any) => sel.value.has(t.journal_id)))
function toggleSel(t: any) { const s = new Set(sel.value); s.has(t.journal_id) ? s.delete(t.journal_id) : s.add(t.journal_id); sel.value = s }
function stopSelect() { selecting.value = false; sel.value = new Set() }
const subPeriod = ref('')
async function selAsSub() {
  await act('subAdd', { journalIds: [...sel.value], period: subPeriod.value || null })
  if (!toast.value) { stopSelect(); goTab('abos') }
}
async function selCategory(c: string) {
  for (const t of selTx.value) { t.category = c; await $fetch('/api/money/action', { method: 'POST', body: { action: 'category', groupId: t.group_id, journalId: t.journal_id, category: c } }) }
  stopSelect(); load()
}
function addSub() { goTab('buchungen'); selecting.value = true; nextTick(() => document.querySelector<HTMLInputElement>('.find input')?.focus()) }

const open = ref<any>(null)
async function setCat(tx: any, c: string) {
  tx.category = c
  for (const list of [L.value?.transactions, found.value]) for (const x of list ?? []) if (x.journal_id === tx.journal_id) x.category = c
  await act('category', { groupId: tx.group_id, journalId: tx.journal_id, category: c })
}
function tapTx(t: any) { if (selecting.value) toggleSel(t); else open.value = t }

const dayTx = computed(() => (day.value ? (L.value?.transactions ?? []).filter((t: any) => t.date === day.value) : []))
const run = computed(() => d.value?.last_run)
const runErrors = computed(() => Object.entries(run.value?.summary ?? {}).filter(([, v]) => typeof v === 'string' && /error|login/.test(v as string)))
const linkFor = (a: any) => d.value?.links?.find((l: any) => l.session_id === a.session_id)
const daysLeft = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 86400000)
</script>

<template>
  <div class="money">
    <div v-if="!d && pending" class="muted pad">Lade…</div>
    <div v-else-if="error && !d" class="bad pad">Die Money-API in CT 108 ist nicht erreichbar: {{ error.statusMessage || error.message }}</div>

    <template v-if="d">
      <div class="strip small">
        <span class="dot" :class="d.syncing ? 'warn' : run ? (run.ok && !runErrors.length ? 'ok' : 'bad') : ''" />
        <span class="muted">{{ d.syncing ? 'synchronisiert…' : run ? `Sync ${ago(run.finished)}` : 'noch kein Sync' }}</span>
        <span v-for="[k, v] in runErrors" :key="k" class="bad">{{ k }}: {{ v }}</span>
        <a class="faint" href="http://192.168.1.58:8080" target="_blank" rel="noopener">Firefly ↗</a>
        <button class="btn ghost ref" :disabled="d.syncing" title="jetzt synchronisieren" @click="act('sync')">{{ d.syncing ? '…' : '↻ Sync' }}</button>
      </div>
      <p v-if="linkMsg" class="small note">{{ linkMsg }}</p>

      <MoneySetup :d="d" @changed="load" />

      <div class="tiles">
        <button class="tile" @click="goTab('konten')"><span class="lbl">Vermögen</span><span class="big num">{{ fmtEur(d.net_worth, 0) }}</span>
          <span class="small faint">Konten {{ fmtEur(d.cash, 0) }}</span></button>
        <button class="tile" @click="goTab('monat')"><span class="lbl">{{ monthTitle(thisMonth).split(' ')[0] }}</span>
          <span class="big num">{{ L && month === thisMonth ? fmtEur(-L.spending, 0) : '–' }}</span>
          <span v-if="L && month === thisMonth" class="small num" :class="L.income - L.spending >= 0 ? 'ok' : 'bad'">Saldo {{ fmtSigned(L.income - L.spending) }}</span></button>
        <button class="tile" @click="goTab('depot')"><span class="lbl">Depot</span><span class="big num">{{ fmtEur(d.invested_value, 0) }}</span>
          <span v-if="gain != null" class="small num" :class="gain >= 0 ? 'ok' : 'bad'">{{ fmtSigned(gain) }} · {{ depotIn ? fmtPct(100 * gain / depotIn) : '' }}</span></button>
        <button class="tile" @click="goTab('abos')"><span class="lbl">Abos / Monat</span><span class="big num">{{ fmtEur(d.subs_monthly, 0) }}</span>
          <span class="small faint">{{ activeSubs.length }} aktiv{{ nextDue ? ` · ${nextDue} diese Woche` : '' }}</span></button>
      </div>

      <nav class="tabs">
        <button v-for="[k, l] in TABS" :key="k" class="tab" :class="{ on: tab === k }" @click="goTab(k)">{{ l }}</button>
      </nav>

      <div v-if="tab === 'monat' || (tab === 'buchungen' && !found)" class="mbar">
        <button class="btn ghost mn" title="Vormonat" @click="shift(-1)">‹</button>
        <label class="mt">
          {{ monthTitle(month) }}
          <input type="month" :value="month" :max="thisMonth" @change="setMonth(($event.target as HTMLInputElement).value || thisMonth)">
        </label>
        <button class="btn ghost mn" :disabled="isNow" title="nächster Monat" @click="shift(1)">›</button>
        <button class="btn today" :class="{ on: isNow && (tab !== 'monat' || day === isoDay()) }" @click="today">Heute</button>
      </div>
      <p v-if="toast" class="bad small">{{ toast }}</p>
      <div v-if="d.ledger_error && (tab === 'monat' || tab === 'buchungen')" class="bad small">Firefly: {{ d.ledger_error }}</div>

      <!-- ── Monat ── -->
      <template v-if="tab === 'monat' && L">
        <div class="sums">
          <span><span class="lbl">Einnahmen</span><b class="num ok">{{ fmtEur(L.income, 0) }}</b></span>
          <span><span class="lbl">Ausgaben</span><b class="num">{{ fmtEur(L.spending, 0) }}</b></span>
          <span><span class="lbl">Saldo</span><b class="num" :class="L.income - L.spending >= 0 ? 'ok' : 'bad'">{{ fmtSigned(L.income - L.spending) }}</b></span>
          <span v-if="vsAvg != null"><span class="lbl">vs. Ø 3 Monate</span><b class="num" :class="vsAvg <= 0 ? 'ok' : 'warn'">{{ fmtSigned(vsAvg) }}</b></span>
        </div>
        <div class="grid cols-2">
          <Panel title="Kalender" :sub="day ? dayTitle(day) : 'Tag antippen'" id="money-cal">
            <MoneyCalendar :month="month" :txs="L.transactions" :subs="activeSubs" :selected="day" @pick="x => setQ({ d: x || undefined })" />
            <div class="calkey small faint"><span><i class="k in" />Eingang</span><span><i class="k due" />Abo fällig</span><span>Zahl = Ausgaben €</span></div>
            <div v-if="day" class="daylist">
              <div v-if="!dayTx.length" class="faint small">Keine Buchungen an diesem Tag.</div>
              <button v-for="t in dayTx" :key="t.journal_id" class="dtx" @click="open = t">
                <span class="py">{{ t.payee }}</span><span class="pill">{{ t.category || '—' }}</span>
                <span class="num" :class="t.amount > 0 ? 'ok' : ''">{{ fmtEur(t.amount) }}</span>
              </button>
              <button v-if="dayTx.length" class="btn ghost small" @click="goTab('buchungen', { d: day })">in Buchungen öffnen →</button>
            </div>
          </Panel>
          <Panel title="Ausgaben nach Kategorie" sub="Strich = Ø der 3 Vormonate" id="money-cats">
            <div v-if="!L.categories.length" class="faint small">Noch keine Ausgaben in diesem Monat.</div>
            <button v-for="c in L.categories" :key="c.name" class="cat"
                    :title="`${c.name}: ${fmtEur(c.amount)} (Ø ${fmtEur(c.avg)})`" @click="goTab('buchungen', { c: c.name, d: undefined })">
              <span class="cn">{{ c.name }}</span>
              <span class="bar"><i :style="{ width: (100 * c.amount / catMax) + '%' }" :class="{ over: c.avg && c.amount > c.avg * 1.2 }" />
                <b v-if="c.avg" class="avg" :style="{ left: (100 * c.avg / catMax) + '%' }" /></span>
              <span class="num cv">{{ fmtEur(c.amount, 0) }}</span>
            </button>
          </Panel>
        </div>
        <Panel title="Letzte 12 Monate" id="money-trend" class="gap">
          <div class="legend small"><span><i class="sw in" />Einnahmen</span><span><i class="sw out" />Ausgaben</span></div>
          <div class="trend">
            <button v-for="t in L.trend" :key="t.month" class="tm" :class="{ on: t.month === month }"
                    :title="`${monthTitle(t.month)}: +${fmtEur(t.income, 0)} / −${fmtEur(t.spending, 0)}`" @click="setMonth(t.month)">
              <span class="bars">
                <i class="in" :style="{ height: (100 * t.income / trendMax) + '%' }" />
                <i class="out" :style="{ height: (100 * t.spending / trendMax) + '%' }" />
              </span>
              <span class="faint">{{ monthShort(t.month) }}</span>
            </button>
          </div>
        </Panel>
      </template>

      <!-- ── Buchungen ── -->
      <template v-if="tab === 'buchungen'">
        <div class="find">
          <input v-model="search" type="search" placeholder="Suchen in allen Buchungen: Empfänger, Zweck, Betrag…" enterkeyhint="search">
          <button class="btn" :class="{ on: selecting }" @click="selecting ? stopSelect() : (selecting = true)">{{ selecting ? 'Fertig' : 'Auswählen' }}</button>
        </div>
        <div class="filters">
          <button class="chip" :class="{ on: !kind }" @click="setQ({ k: undefined })">Alle</button>
          <button class="chip" :class="{ on: kind === 'out' }" @click="setQ({ k: 'out' })">Ausgaben</button>
          <button class="chip" :class="{ on: kind === 'in' }" @click="setQ({ k: 'in' })">Eingänge</button>
          <select class="chip sel" :value="cat" @change="setQ({ c: ($event.target as HTMLSelectElement).value || undefined })">
            <option value="">Alle Kategorien</option>
            <option v-for="c in d.categories" :key="c" :value="c">{{ c }}</option>
          </select>
          <select v-if="accounts.length > 1" class="chip sel" :value="acct" @change="setQ({ a: ($event.target as HTMLSelectElement).value || undefined })">
            <option value="">Alle Konten</option>
            <option v-for="a in accounts" :key="a" :value="a">{{ a }}</option>
          </select>
          <button v-if="day && !found" class="chip on" @click="setQ({ d: undefined })">{{ dayTitle(day) }} ✕</button>
        </div>
        <p class="small faint count">
          <template v-if="searching">suche…</template>
          <template v-else>{{ txShown.length }} Buchungen{{ found ? ` mit „${search.trim()}“ (alle Monate)` : '' }} · Summe <b class="num" :class="shownSum >= 0 ? 'ok' : ''">{{ fmtEur(shownSum) }}</b></template>
          <template v-if="selecting"> · <span class="accent">Buchungen antippen zum Auswählen</span></template>
        </p>
        <div class="txs">
          <div v-if="!groups.length && !searching" class="faint small pad2">Keine Buchungen.</div>
          <section v-for="g in groups" :key="g.day" class="dg">
            <header class="dh small"><span>{{ dayTitle(g.day) }}</span><span class="num faint">{{ g.sum ? fmtEur(g.sum) : '' }}</span></header>
            <button v-for="tx in g.txs" :key="tx.journal_id" class="tx" :class="{ picked: sel.has(tx.journal_id) }" @click="tapTx(tx)">
              <span v-if="selecting" class="ck">{{ sel.has(tx.journal_id) ? '✓' : '' }}</span>
              <span class="tp">
                <span class="py">{{ tx.payee }}</span>
                <span class="faint small ds">{{ tx.description !== tx.payee ? tx.description : '' }}</span>
              </span>
              <span class="tr">
                <span class="num amt" :class="tx.amount > 0 ? 'ok' : ''">{{ fmtEur(tx.amount) }}</span>
                <span class="pill catp">{{ tx.category || '—' }}</span>
              </span>
            </button>
          </section>
          <button v-if="txShown.length > LIMIT" class="btn ghost more" @click="LIMIT += 300">mehr ({{ txShown.length - LIMIT }})</button>
        </div>
        <div v-if="selecting && sel.size" class="selbar">
          <span class="small"><b>{{ sel.size }}</b> · {{ fmtEur(selTx.reduce((a: number, t: any) => a + t.amount, 0)) }}</span>
          <select v-model="subPeriod" class="small"><option value="">Rhythmus auto</option><option v-for="(v, k) in PERIODS" :key="k" :value="k">{{ v.label }}</option></select>
          <button class="btn primary" @click="selAsSub">Als Abo</button>
          <select class="small" value="" @change="selCategory(($event.target as HTMLSelectElement).value)">
            <option value="" disabled>Kategorie…</option>
            <option v-for="c in d.categories" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
      </template>

      <MoneySubs v-if="tab === 'abos'" :subs="d.subs" :hidden="d.subs_hidden ?? []" @act="act" @open="x => (open = x)" @add="addSub" />

      <MoneyDepot v-if="tab === 'depot'" :positions="pf?.positions ?? []" :cash="trCash" />

      <template v-if="tab === 'konten'">
        <Panel title="Konten" :sub="`${fmtEur(d.cash, 0)} gesamt`" id="money-accounts">
          <template #actions>
            <button class="btn small" :disabled="d.syncing" @click="act('sync')">{{ d.syncing ? 'synchronisiert…' : '↻ Jetzt synchronisieren' }}</button>
          </template>
          <div v-if="!d.accounts.length" class="faint small">Noch keine Konten verbunden.</div>
          <div v-for="a in d.accounts" :key="a.key" class="acc">
            <span class="dot" :class="a.error ? 'bad' : a.last_sync ? 'ok' : ''" />
            <span class="an">
              <span>{{ a.name }}<span v-if="a.iban" class="faint small"> · {{ a.iban.slice(-4) }}</span></span>
              <span class="faint small">
                {{ a.last_sync ? `Sync ${ago(a.last_sync)}` : 'noch nicht synchronisiert' }}
                <template v-if="linkFor(a)?.valid_until"> · Zugriff noch {{ daysLeft(linkFor(a).valid_until) }} Tage</template>
              </span>
              <span v-if="a.error" class="bad small">{{ a.error }}</span>
            </span>
            <button class="btn ghost small" @click="goTab('buchungen', { a: a.name })">Buchungen</button>
            <span class="num ab">{{ fmtEur(a.balance) }}</span>
          </div>
        </Panel>
      </template>

      <MoneyTxSheet v-if="open" :tx="open" :categories="d.categories" @close="open = null" @category="setCat" @changed="load" />
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 48px 0; text-align: center; }
.pad2 { padding: 24px 0; text-align: center; }
.strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 2px 12px; }
.strip .ref { margin-left: auto; padding: 2px 8px; }
.note { margin: 0 2px 12px; color: var(--accent); }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; min-width: 0; font: inherit; color: var(--text); text-align: left; cursor: pointer; }
.tile:hover { border-color: var(--line-2); }
.lbl { font-size: 12px; color: var(--muted); }
.tile .num { text-align: left; }
.big { font-size: 22px; font-weight: 600; }
@media (max-width: 760px) { .tiles { grid-template-columns: 1fr 1fr; gap: 8px; } .big { font-size: 19px; } }

.tabs { position: sticky; top: 0; z-index: 5; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; background: var(--bg); padding: 6px 0; margin-bottom: 8px; border-bottom: 1px solid var(--line); }
.tab { flex: 1 0 auto; padding: 7px 14px; border: 0; border-radius: 8px; background: none; color: var(--muted); font: inherit; font-size: 13.5px; cursor: pointer; }
.tab:hover { color: var(--text); }
.tab.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }

.mbar { display: flex; align-items: center; gap: 4px; margin: 8px 0 12px; }
.mn { padding: 2px 10px; font-size: 18px; }
.mt { position: relative; font-size: 16px; font-weight: 600; padding: 4px 8px; border-radius: 8px; cursor: pointer; min-width: 150px; text-align: center; }
.mt:hover { background: var(--panel-2); }
.mt input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
.today { margin-left: auto; }
.today.on { color: var(--accent); border-color: var(--accent); }

.gap { margin-top: 16px; }
.sums { display: flex; gap: 8px 22px; flex-wrap: wrap; margin-bottom: 14px; }
.sums > span { display: flex; flex-direction: column; }
.sums b { font-size: 17px; font-weight: 600; text-align: left; }
.calkey { display: flex; gap: 14px; margin-top: 8px; flex-wrap: wrap; }
.k { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; vertical-align: 1px; }
.k.in { background: var(--ok); } .k.due { background: var(--warn); }
.daylist { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 6px; }
.dtx { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; width: 100%; padding: 6px 4px; border: 0; background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; border-radius: 6px; }
.dtx:hover { background: var(--accent-soft); }
.cat { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; align-items: center; gap: 10px; width: 100%; padding: 5px 4px; border: 0; border-radius: 6px; background: none; color: var(--text); font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
.cat:hover { background: var(--accent-soft); }
.cn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { position: relative; height: 8px; background: var(--track); border-radius: 4px; }
.bar i { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
.bar i.over { background: var(--warn); }
.bar .avg { position: absolute; top: -3px; width: 2px; height: 14px; background: var(--text); opacity: .6; border-radius: 1px; }
.cv { min-width: 64px; text-align: right; }
.legend { display: flex; gap: 14px; color: var(--muted); margin-bottom: 8px; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.sw.in, .bars .in { background: var(--ok); opacity: .75; }
.sw.out, .bars .out { background: var(--accent); }
.trend { display: flex; gap: 4px; align-items: stretch; height: 160px; }
.tm { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; font: inherit; font-size: 11px; cursor: pointer; border-radius: 6px; padding: 4px 0; }
.tm.on, .tm:hover { background: var(--accent-soft); }
.bars { flex: 1; display: flex; align-items: flex-end; gap: 2px; width: 80%; justify-content: center; }
.bars i { width: 45%; max-width: 16px; border-radius: 3px 3px 0 0; min-height: 1px; }

.find { display: flex; gap: 8px; margin: 4px 0 10px; }
.find input { flex: 1; min-width: 0; padding: 8px 12px; }
.find .btn.on { color: var(--accent); border-color: var(--accent); }
.filters { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin-bottom: 6px; }
.chip { flex: none; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.chip.on { background: var(--accent-soft); color: var(--accent); border-color: transparent; font-weight: 600; }
.chip.sel { padding: 4px 8px; font-size: 12.5px; }
.count { margin: 4px 2px 8px; }
.count b { color: var(--text); }
.accent { color: var(--accent); }
.txs { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 4px 14px 10px; }
.dg + .dg { margin-top: 4px; }
.dh { position: sticky; top: 48px; z-index: 2; display: flex; justify-content: space-between; padding: 8px 0 4px; background: var(--panel); color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--line); }
.tx { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 4px; border: 0; border-bottom: 1px solid var(--line); background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.tx:last-child { border-bottom: 0; }
.tx:hover { background: var(--panel-2); }
.tx.picked { background: var(--accent-soft); }
.ck { flex: none; width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid var(--line-2); display: grid; place-items: center; font-size: 12px; color: var(--accent); }
.picked .ck { border-color: var(--accent); }
.tp { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.py, .ds { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tr { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.catp { font-size: 11px; }
.amt { font-weight: 500; }
.more { width: 100%; margin-top: 6px; }
.selbar { position: sticky; bottom: calc(var(--tabbar) + 10px); z-index: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; padding: 10px 12px; background: var(--panel-2); border: 1px solid var(--accent); border-radius: 12px; box-shadow: 0 6px 24px rgba(0, 0, 0, .5); }
.selbar select { padding: 5px 8px; }
.btn.small { font-size: 12px; padding: 4px 10px; }
.acc { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
.acc:first-of-type { border-top: 0; }
.an { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.ab { min-width: 90px; }
</style>
