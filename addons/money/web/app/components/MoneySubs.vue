<script setup lang="ts">
/** Abos tab: what's due next, every subscription with its monthly weight (net of friends' shares), regular income,
 *  edit/rename/hide, and the hidden ones back */
const props = defineProps<{ subs: any[], hidden: any[] }>()
const emit = defineEmits<{ act: [string, Record<string, any>], open: [any], add: [] }>()
const { armed, arm } = useArm()

const monthly = (s: any) => s.amount * (PERIODS[s.period]?.perMonth ?? 1)
const net = (s: any) => monthly(s) - (s.share_monthly || 0)
const isIn = (s: any) => s.kind === 'in'
const active = computed(() => props.subs.filter(s => s.state === 'active' && !isIn(s)).sort((a, b) => net(b) - net(a)))
const ended = computed(() => props.subs.filter(s => s.state !== 'active' && !isIn(s)))
const income = computed(() => props.subs.filter(s => isIn(s)).sort((a, b) => (a.state === 'active' ? 0 : 1) - (b.state === 'active' ? 0 : 1) || monthly(b) - monthly(a)))
const perMonth = computed(() => active.value.reduce((a, s) => a + net(s), 0))
const inMonth = computed(() => income.value.filter(s => s.state === 'active').reduce((a, s) => a + monthly(s), 0))
const upcoming = computed(() => {
  const end = new Date(); end.setDate(end.getDate() + 31)
  const today = isoDay()
  return [...active.value, ...income.value].flatMap(s => subCharges(s, isoDay(end)).filter(d => d >= today).map(d => ({ d, s }))).sort((a, b) => a.d.localeCompare(b.d))
})
const sections = computed(() => [
  { id: 'money-subs', title: 'Subscriptions & recurring', sub: `${active.value.length} active`, list: [...active.value, ...(showEnded.value ? ended.value : [])] },
  ...(income.value.length ? [{ id: 'money-income', title: 'Regular income', sub: `≈ ${fmtEur(inMonth.value, 0)} / month`, list: income.value }] : []),
])
const priceUp = (s: any) => s.prev_amount != null && Math.abs(s.amount - s.prev_amount) >= 0.01 && s.changed && Date.now() / 1000 - s.changed < 60 * 86400

const open = ref('')
const nameDraft = ref('')
function expand(s: any) { open.value = open.value === s.key ? '' : s.key; nameDraft.value = s.name || '' }
function rename(s: any) { if ((s.name || '') !== nameDraft.value.trim()) emit('act', 'subEdit', { key: s.key, name: nameDraft.value.trim() }) }
const asTx = (s: any) => ({ journal_id: `sub:${s.key}`, payee: s.payee, amount: isIn(s) ? s.amount : -s.amount, date: s.last_date, account: '', description: '', category: s.category })
const showEnded = ref(false)
const showHidden = ref(false)
</script>

<template>
  <div>
    <div class="sum">
      <div><span class="lbl">Subs / month</span><b class="num">{{ fmtEur(perMonth) }}</b></div>
      <div><span class="lbl">per year</span><b class="num">{{ fmtEur(perMonth * 12, 0) }}</b></div>
      <div v-if="income.length"><span class="lbl">Income / month</span><b class="num ok">{{ fmtEur(inMonth, 0) }}</b></div>
      <div v-else><span class="lbl">active</span><b>{{ active.length }}</b></div>
      <button class="btn add" @click="emit('add')">＋ Sub from bookings</button>
    </div>

    <Panel title="Due soon" sub="next 31 days" id="money-due">
      <div v-if="!upcoming.length" class="faint small">Nothing due.</div>
      <div v-for="u in upcoming" :key="u.s.key + u.d" class="due small">
        <span class="faint dd">{{ dayTitle(u.d) }}</span>
        <span class="dn">{{ subName(u.s) }}</span>
        <span class="num" :class="{ ok: isIn(u.s) }">{{ isIn(u.s) ? '+' : '' }}{{ fmtEur(u.s.amount) }}</span>
      </div>
    </Panel>

    <Panel v-for="sec in sections" :key="sec.id" :title="sec.title" :sub="sec.sub" :id="sec.id" class="gap">
      <div v-if="!sec.list.length" class="faint small">None detected yet – or add one yourself.</div>
      <div v-for="s in sec.list" :key="s.key" class="sub" :class="{ ended: s.state !== 'active', open: open === s.key }">
        <button class="row" @click="expand(s)">
          <span class="sp">
            <span class="nm">{{ subName(s) }}</span>
            <span class="faint small">
              <template v-if="s.state === 'active'">next {{ dayTitle(s.next_date) }}</template><template v-else>last {{ s.last_date ? dayTitle(s.last_date) : '–' }} · ended?</template>
              <span v-if="s.manual" class="pill">manual</span>
              <span v-if="priceUp(s)" class="pill warn">{{ fmtEur(s.prev_amount) }} → {{ fmtEur(s.amount) }}</span>
            </span>
          </span>
          <span class="am">
            <span class="num" :class="{ ok: isIn(s) }">{{ isIn(s) ? '+' : '' }}{{ fmtEur(s.amount) }}<span class="faint"> / {{ PERIODS[s.period]?.per }}</span></span>
            <span v-if="s.share_monthly > 0" class="faint small num">− {{ fmtEur(s.share_monthly) }} shares = <b class="netv">{{ fmtEur(net(s)) }}</b></span>
            <span v-else-if="s.period !== 'monthly'" class="faint small num">≈ {{ fmtEur(monthly(s)) }} / month</span>
          </span>
        </button>
        <div v-if="open === s.key && s.shares?.length" class="shares small">
          <div v-for="sh in s.shares" :key="sh.pkey" class="sh" :class="{ off: !sh.active }">
            <span>{{ sh.payee }}</span>
            <span class="faint">{{ sh.last_date ? `last ${dayTitle(sh.last_date)}` : 'nothing yet' }}{{ sh.active ? '' : ' · stopped paying?' }}</span>
            <span class="num ok">{{ fmtEur(sh.amount) }}</span>
            <button class="lnk" title="Stop netting" @click="emit('act', 'subShare', { key: s.key, remove: sh.pkey })">✕</button>
          </div>
        </div>
        <div v-if="open === s.key" class="edit">
          <input v-model="nameDraft" :placeholder="s.payee" maxlength="80" class="small" @blur="rename(s)" @keydown.enter="rename(s)">
          <select :value="s.period" class="small" @change="emit('act', 'subEdit', { key: s.key, period: ($event.target as HTMLSelectElement).value })">
            <option v-for="(v, k) in PERIODS" :key="k" :value="k">{{ v.label }}</option>
          </select>
          <button class="btn sm" @click="emit('open', asTx(s))">Bookings</button>
          <button class="btn danger sm" :class="{ sure: armed === s.key }" @click="arm(s.key) && emit('act', 'subRemove', { key: s.key })">
            {{ armed === s.key ? 'Sure?' : s.manual ? 'Delete' : 'Not a sub' }}
          </button>
        </div>
      </div>
      <div v-if="sec.id === 'money-subs'" class="more small">
        <button v-if="ended.length" class="btn ghost" @click="showEnded = !showEnded">{{ showEnded ? 'Hide ended' : `${ended.length} ended` }}</button>
        <button v-if="hidden.length" class="btn ghost" @click="showHidden = !showHidden">{{ hidden.length }} hidden</button>
      </div>
      <div v-if="showHidden && sec.id === 'money-subs'">
        <div v-for="h in hidden" :key="h.key" class="hid small">
          <span class="faint">{{ subName(h) }} · {{ fmtEur(h.amount) }} / {{ PERIODS[h.period]?.per }}</span>
          <button class="btn ghost" @click="emit('act', 'subRestore', { key: h.key })">Restore</button>
        </div>
      </div>
    </Panel>
  </div>
</template>

<style scoped>
.sum { display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: center; margin-bottom: 14px; }
.sum > div { display: flex; flex-direction: column; }
.sum b { font-size: 19px; font-weight: 600; text-align: left; }
.lbl { font-size: 12px; color: var(--muted); }
.add { margin-left: auto; }
.gap { margin-top: 16px; }
.due { display: grid; grid-template-columns: minmax(84px, auto) minmax(0, 1fr) auto; gap: 10px; padding: 5px 0; border-top: 1px solid var(--line); }
.due:first-of-type { border-top: 0; }
.dn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { border-top: 1px solid var(--line); }
.sub:first-of-type { border-top: 0; }
.sub.ended { opacity: .55; }
.row { display: flex; gap: 10px; width: 100%; padding: 8px 4px; border: 0; background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; border-radius: 6px; }
.row:hover, .open .row { background: var(--accent-soft); }
.sp { flex: 1; display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.sp .small { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.am { display: flex; flex-direction: column; align-items: flex-end; }
.edit { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 4px 10px; }
.edit input { flex: 1; min-width: 140px; padding: 5px 8px; }
.edit select { padding: 5px 8px; }
.more { display: flex; gap: 6px; margin-top: 8px; }
.shares { padding: 2px 4px 6px; }
.sh { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 10px; align-items: center; padding: 3px 0; }
.sh.off { opacity: .55; }
.sh .lnk { color: var(--muted); padding: 0 4px; }
@media (pointer: coarse) { .sh .lnk { min-width: 32px; min-height: 32px; } }
.netv { font-weight: 600; color: var(--text); }
.hid { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
@media (max-width: 560px) { .sum { gap: 8px 16px; } .sum b { font-size: 16px; } .add { margin-left: 0; width: 100%; } .row { padding: 8px 2px; } }
</style>
