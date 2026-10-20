<script setup lang="ts">
useHead({ title: 'Money · pve' })
const route = useRoute()
const router = useRouter()

const month = ref(new Date().toISOString().slice(0, 7))
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

async function act(action: string, body: Record<string, any> = {}) {
  try { await $fetch('/api/money/action', { method: 'POST', body: { action, ...body } }) } finally { load() }
}

const eur = (n?: number | null, frac = 2) => (n == null ? '–' : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: frac, maximumFractionDigits: frac }))
const L = computed(() => d.value?.ledger)
const monthName = (m: string) => new Date(m + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
const monthShort = (m: string) => new Date(m + '-01').toLocaleDateString('de-DE', { month: 'short' })
function shift(n: number) {
  const [y, m] = month.value.split('-').map(Number)
  const dt = new Date(y!, m! - 1 + n, 1)
  month.value = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}
const isNow = computed(() => month.value >= new Date().toISOString().slice(0, 7))

const catMax = computed(() => Math.max(1, ...(L.value?.categories ?? []).map((c: any) => c.amount)))
const trendMax = computed(() => Math.max(1, ...(L.value?.trend ?? []).flatMap((t: any) => [t.income, t.spending])))

const pf = computed(() => d.value?.portfolio)
const pfLast = computed(() => pf.value?.series?.at(-1))
const gain = computed(() => (pfLast.value ? pfLast.value.value - (pfLast.value.cash ?? 0) - pfLast.value.invested : null))

const activeSubs = computed(() => (d.value?.subs ?? []).filter((s: any) => s.state === 'active'))
const endedSubs = computed(() => (d.value?.subs ?? []).filter((s: any) => s.state !== 'active'))
const PER: Record<string, string> = { weekly: 'Woche', monthly: 'Monat', quarterly: 'Quartal', yearly: 'Jahr' }
const priceUp = (s: any) => s.prev_amount != null && Math.abs(s.amount - s.prev_amount) >= 0.01 && s.changed && Date.now() / 1000 - s.changed < 60 * 86400

const txFilter = ref('')
const txShown = computed(() => (L.value?.transactions ?? []).filter((t: any) => !txFilter.value || t.category === txFilter.value).slice(0, 150))
const editTx = ref<string | null>(null)
async function setCat(t: any, cat: string) {
  editTx.value = null
  t.category = cat
  await act('category', { groupId: t.group_id, journalId: t.journal_id, category: cat })
}
const dd = (s: string) => new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
const run = computed(() => d.value?.last_run)
const runErrors = computed(() => Object.entries(run.value?.summary ?? {}).filter(([, v]) => typeof v === 'string' && /error|login/.test(v as string)))
</script>

<template>
  <div>
    <div v-if="!d && pending" class="muted pad">Lade…</div>
    <div v-else-if="error && !d" class="bad pad">Die Money-API in CT 108 ist nicht erreichbar: {{ error.statusMessage || error.message }}</div>

    <template v-if="d">
      <div class="strip small">
        <span class="dot" :class="d.syncing ? 'warn' : run ? (run.ok && !runErrors.length ? 'ok' : 'bad') : ''" />
        <span class="muted">{{ d.syncing ? 'synchronisiert…' : run ? `Sync ${ago(run.finished)}` : 'noch kein Sync' }}</span>
        <span v-for="[k, v] in runErrors" :key="k" class="bad">{{ k }}: {{ v }}</span>
        <a class="faint" href="http://192.168.1.58:8080" target="_blank" rel="noopener">Firefly ↗</a>
        <button class="btn ghost ref" :disabled="d.syncing" title="jetzt synchronisieren" @click="act('sync')">↻</button>
      </div>
      <p v-if="linkMsg" class="small note">{{ linkMsg }}</p>

      <MoneySetup :d="d" @changed="load" />

      <div class="tiles">
        <div class="tile"><span class="lbl">Vermögen</span><span class="big num">{{ eur(d.net_worth, 0) }}</span></div>
        <div class="tile"><span class="lbl">Konten</span><span class="big num">{{ eur(d.cash, 0) }}</span></div>
        <div class="tile"><span class="lbl">Depot</span><span class="big num">{{ eur(d.invested_value, 0) }}</span>
          <span v-if="gain != null" class="small num" :class="gain >= 0 ? 'ok' : 'bad'">{{ gain >= 0 ? '+' : '' }}{{ eur(gain, 0) }}</span></div>
        <div class="tile"><span class="lbl">Abos / Monat</span><span class="big num">{{ eur(d.subs_monthly) }}</span>
          <span class="small faint">{{ activeSubs.length }} aktiv</span></div>
      </div>

      <h2 class="sec">
        <button class="btn ghost mn" @click="shift(-1)">‹</button>
        {{ monthName(month) }}
        <button class="btn ghost mn" :disabled="isNow" @click="shift(1)">›</button>
      </h2>
      <div v-if="d.ledger_error" class="bad small">Firefly: {{ d.ledger_error }}</div>
      <div v-else-if="L" class="grid cols-2">
        <Panel title="Ausgaben nach Kategorie" id="money-cats">
          <div class="sums small">
            <span>Einnahmen <b class="num">{{ eur(L.income, 0) }}</b></span>
            <span>Ausgaben <b class="num">{{ eur(L.spending, 0) }}</b></span>
            <span>Saldo <b class="num" :class="L.income - L.spending >= 0 ? 'ok' : 'bad'">{{ eur(L.income - L.spending, 0) }}</b></span>
          </div>
          <div v-if="!L.categories.length" class="faint small">Noch keine Ausgaben in diesem Monat.</div>
          <button v-for="c in L.categories" :key="c.name" class="cat" :class="{ on: txFilter === c.name }"
                  :title="`${c.name}: ${eur(c.amount)}`" @click="txFilter = txFilter === c.name ? '' : c.name">
            <span class="cn">{{ c.name }}</span>
            <span class="bar"><i :style="{ width: (100 * c.amount / catMax) + '%' }" /></span>
            <span class="num cv">{{ eur(c.amount, 0) }}</span>
          </button>
        </Panel>
        <Panel title="Letzte Monate" id="money-trend">
          <div class="legend small"><span><i class="sw in" />Einnahmen</span><span><i class="sw out" />Ausgaben</span></div>
          <div class="trend">
            <button v-for="t in L.trend" :key="t.month" class="tm" :class="{ on: t.month === month }"
                    :title="`${monthName(t.month)}: +${eur(t.income, 0)} / −${eur(t.spending, 0)}`" @click="month = t.month">
              <span class="bars">
                <i class="in" :style="{ height: (100 * t.income / trendMax) + '%' }" />
                <i class="out" :style="{ height: (100 * t.spending / trendMax) + '%' }" />
              </span>
              <span class="faint">{{ monthShort(t.month) }}</span>
            </button>
          </div>
        </Panel>
      </div>

      <div class="grid cols-2 gap">
        <Panel title="Abos & wiederkehrend" :sub="activeSubs.length ? `${eur(d.subs_monthly)} / Monat` : ''" id="money-subs">
          <div v-if="!d.subs.length" class="faint small">Wird aus den Buchungen erkannt (gleicher Empfänger, fester Rhythmus).</div>
          <div v-for="s in [...activeSubs, ...endedSubs]" :key="s.key" class="sub" :class="{ ended: s.state !== 'active' }">
            <span class="sp">{{ s.payee }}<span v-if="priceUp(s)" class="pill warn">{{ eur(s.prev_amount) }} → {{ eur(s.amount) }}</span></span>
            <span class="num">{{ eur(s.amount) }}<span class="faint"> / {{ PER[s.period] }}</span></span>
            <span class="faint small nx">{{ s.state === 'active' ? `nächste ~${dd(s.next_date)}` : 'beendet?' }}</span>
            <button class="btn ghost x" title="kein Abo – ausblenden" @click="act('subDismiss', { key: s.key })">×</button>
          </div>
        </Panel>
        <Panel title="Depot" :sub="pfLast ? eur(pfLast.value, 0) : ''" id="money-depot">
          <MoneyLine :series="pf.series" />
          <div v-for="p in pf.positions.slice(0, 12)" :key="p.isin" class="pos small">
            <span class="pn">{{ p.name }}</span>
            <span class="num">{{ eur(p.value, 0) }}</span>
            <span class="num" :class="p.value - p.buyin >= 0 ? 'ok' : 'bad'">{{ p.buyin ? ((100 * (p.value - p.buyin)) / p.buyin).toFixed(1) + ' %' : '' }}</span>
          </div>
          <div v-if="!pf.positions.length" class="faint small">Trade Republic verbinden, dann kommt hier der tägliche Depotwert.</div>
        </Panel>
      </div>

      <Panel title="Buchungen" :sub="txFilter || `${L?.transactions.length ?? 0} im Monat`" id="money-tx" class="gap">
        <template #actions><button v-if="txFilter" class="btn ghost" @click="txFilter = ''">alle</button></template>
        <div v-if="!txShown.length" class="faint small">Keine Buchungen.</div>
        <div v-for="t in txShown" :key="t.journal_id" class="tx">
          <span class="faint small dt">{{ dd(t.date) }}</span>
          <span class="tp">
            <span class="py">{{ t.payee }}</span>
            <span class="faint small ds">{{ t.description !== t.payee ? t.description : '' }} · {{ t.account }}</span>
          </span>
          <select v-if="editTx === t.journal_id" class="cs" :value="t.category" @change="setCat(t, ($event.target as HTMLSelectElement).value)" @blur="editTx = null">
            <option v-for="c in d.categories" :key="c" :value="c">{{ c }}</option>
          </select>
          <button v-else class="pill catp" title="Kategorie ändern" @click="editTx = t.journal_id">{{ t.category || '—' }}</button>
          <span class="num amt" :class="t.amount > 0 ? 'ok' : ''">{{ eur(t.amount) }}</span>
        </div>
      </Panel>

      <Panel title="Konten" id="money-accounts" fold="phone" class="gap">
        <div v-if="!d.accounts.length" class="faint small">Noch keine Konten verbunden.</div>
        <div v-for="a in d.accounts" :key="a.key" class="acc">
          <span class="dot" :class="a.error ? 'bad' : a.last_sync ? 'ok' : ''" />
          <span class="an">{{ a.name }}<span v-if="a.iban" class="faint small"> · {{ a.iban.slice(-4) }}</span></span>
          <span v-if="a.error" class="bad small">{{ a.error }}</span>
          <span class="num ab">{{ eur(a.balance) }}</span>
        </div>
      </Panel>
    </template>
  </div>
</template>

<style scoped>
.pad { padding: 48px 0; text-align: center; }
.strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 2px 12px; }
.strip .ref { margin-left: auto; padding: 2px 8px; }
.note { margin: 0 2px 12px; color: var(--accent); }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lbl { font-size: 12px; color: var(--muted); }
.tile .num { text-align: left; }
.big { font-size: 22px; font-weight: 600; }
@media (max-width: 760px) { .tiles { grid-template-columns: 1fr 1fr; } .big { font-size: 19px; } }
.sec { display: flex; align-items: center; gap: 6px; }
.mn { padding: 0 8px; font-size: 16px; }
.gap { margin-top: 16px; }
.sums { display: flex; gap: 16px; flex-wrap: wrap; color: var(--muted); margin-bottom: 12px; }
.sums b { color: var(--text); }
.cat { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; align-items: center; gap: 10px; width: 100%; padding: 5px 4px; border: 0; border-radius: 6px; background: none; color: var(--text); font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
.cat:hover, .cat.on { background: var(--accent-soft); }
.cn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { height: 8px; background: var(--track); border-radius: 4px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); border-radius: 0 4px 4px 0; }
.cv { min-width: 64px; text-align: right; }
.legend { display: flex; gap: 14px; color: var(--muted); margin-bottom: 8px; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.sw.in, .bars .in { background: var(--muted); }
.sw.out, .bars .out { background: var(--accent); }
.trend { display: flex; gap: 6px; align-items: stretch; height: 170px; }
.tm { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; font: inherit; font-size: 11.5px; cursor: pointer; border-radius: 6px; padding: 4px 0; }
.tm.on, .tm:hover { background: var(--accent-soft); }
.bars { flex: 1; display: flex; align-items: flex-end; gap: 2px; width: 70%; justify-content: center; }
.bars i { width: 45%; max-width: 18px; border-radius: 4px 4px 0 0; min-height: 1px; }
.sub { display: grid; grid-template-columns: 1fr auto auto 26px; gap: 10px; align-items: center; padding: 6px 0; border-top: 1px solid var(--line); font-size: 13px; }
.sub:first-of-type { border-top: 0; }
.sub.ended { opacity: .5; }
.sp { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; min-width: 0; }
.x { padding: 0 6px; }
@media (max-width: 560px) { .nx { display: none; } .sub { grid-template-columns: 1fr auto 26px; } }
.pos { display: grid; grid-template-columns: 1fr auto 64px; gap: 10px; padding: 4px 0; border-top: 1px solid var(--line); }
.pos .num:last-child { text-align: right; }
.pn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tx { display: grid; grid-template-columns: 44px 1fr auto auto; gap: 10px; align-items: center; padding: 7px 0; border-top: 1px solid var(--line); font-size: 13px; }
.tx:first-of-type { border-top: 0; }
.tp { display: flex; flex-direction: column; min-width: 0; }
.py, .ds { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.catp { cursor: pointer; border: 0; font: inherit; font-size: 11.5px; }
.cs { max-width: 160px; font-size: 12px; }
.amt { min-width: 80px; text-align: right; }
@media (max-width: 560px) { .tx { grid-template-columns: 1fr auto; } .dt { display: none; } .catp, .cs { grid-column: 1; justify-self: start; } .amt { grid-row: 1; grid-column: 2; } }
.acc { display: flex; align-items: center; gap: 8px; padding: 6px 0; flex-wrap: wrap; }
.ab { margin-left: auto; }
</style>
