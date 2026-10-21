<script setup lang="ts">
/** Abos tab: what's due next, every subscription with its monthly weight, edit/rename/hide, and the hidden ones back */
const props = defineProps<{ subs: any[], hidden: any[] }>()
const emit = defineEmits<{ act: [string, Record<string, any>], open: [any], add: [] }>()
const { armed, arm } = useArm()

const monthly = (s: any) => s.amount * (PERIODS[s.period]?.perMonth ?? 1)
const active = computed(() => props.subs.filter(s => s.state === 'active').sort((a, b) => monthly(b) - monthly(a)))
const ended = computed(() => props.subs.filter(s => s.state !== 'active'))
const perMonth = computed(() => active.value.reduce((a, s) => a + monthly(s), 0))
const upcoming = computed(() => {
  const end = new Date(); end.setDate(end.getDate() + 31)
  const today = isoDay()
  return active.value.flatMap(s => subCharges(s, isoDay(end)).filter(d => d >= today).map(d => ({ d, s }))).sort((a, b) => a.d.localeCompare(b.d))
})
const priceUp = (s: any) => s.prev_amount != null && Math.abs(s.amount - s.prev_amount) >= 0.01 && s.changed && Date.now() / 1000 - s.changed < 60 * 86400

const open = ref('')
const nameDraft = ref('')
function expand(s: any) { open.value = open.value === s.key ? '' : s.key; nameDraft.value = s.name || '' }
function rename(s: any) { if ((s.name || '') !== nameDraft.value.trim()) emit('act', 'subEdit', { key: s.key, name: nameDraft.value.trim() }) }
const asTx = (s: any) => ({ journal_id: `sub:${s.key}`, payee: s.payee, amount: -s.amount, date: s.last_date, account: '', description: '', category: s.category })
const showEnded = ref(false)
const showHidden = ref(false)
</script>

<template>
  <div>
    <div class="sum">
      <div><span class="lbl">pro Monat</span><b class="num">{{ fmtEur(perMonth) }}</b></div>
      <div><span class="lbl">pro Jahr</span><b class="num">{{ fmtEur(perMonth * 12, 0) }}</b></div>
      <div><span class="lbl">aktiv</span><b>{{ active.length }}</b></div>
      <button class="btn add" @click="emit('add')">＋ Abo aus Buchungen</button>
    </div>

    <Panel title="Demnächst fällig" sub="nächste 31 Tage" id="money-due">
      <div v-if="!upcoming.length" class="faint small">Nichts fällig.</div>
      <div v-for="u in upcoming" :key="u.s.key + u.d" class="due small">
        <span class="faint dd">{{ dayTitle(u.d) }}</span>
        <span class="dn">{{ subName(u.s) }}</span>
        <span class="num">{{ fmtEur(u.s.amount) }}</span>
      </div>
    </Panel>

    <Panel title="Abos & wiederkehrend" :sub="`${active.length} aktiv`" id="money-subs" class="gap">
      <div v-if="!subs.length" class="faint small">Wird aus den Buchungen erkannt (gleicher Empfänger, fester Rhythmus) – oder selbst hinzufügen.</div>
      <div v-for="s in [...active, ...(showEnded ? ended : [])]" :key="s.key" class="sub" :class="{ ended: s.state !== 'active', open: open === s.key }">
        <button class="row" @click="expand(s)">
          <span class="sp">
            <span class="nm">{{ subName(s) }}</span>
            <span class="faint small">
              <template v-if="s.state === 'active'">nächste {{ dayTitle(s.next_date) }}</template><template v-else>zuletzt {{ s.last_date ? dayTitle(s.last_date) : '–' }} · beendet?</template>
              <span v-if="s.manual" class="pill">selbst</span>
              <span v-if="priceUp(s)" class="pill warn">{{ fmtEur(s.prev_amount) }} → {{ fmtEur(s.amount) }}</span>
            </span>
          </span>
          <span class="am">
            <span class="num">{{ fmtEur(s.amount) }}<span class="faint"> / {{ PERIODS[s.period]?.per }}</span></span>
            <span v-if="s.period !== 'monthly'" class="faint small num">≈ {{ fmtEur(monthly(s)) }} / Monat</span>
          </span>
        </button>
        <div v-if="open === s.key" class="edit">
          <input v-model="nameDraft" :placeholder="s.payee" maxlength="80" class="small" @blur="rename(s)" @keydown.enter="rename(s)">
          <select :value="s.period" class="small" @change="emit('act', 'subEdit', { key: s.key, period: ($event.target as HTMLSelectElement).value })">
            <option v-for="(v, k) in PERIODS" :key="k" :value="k">{{ v.label }}</option>
          </select>
          <button class="btn small" @click="emit('open', asTx(s))">Buchungen</button>
          <button class="btn danger small" :class="{ sure: armed === s.key }" @click="arm(s.key) && emit('act', 'subRemove', { key: s.key })">
            {{ armed === s.key ? 'Sicher?' : s.manual ? 'Löschen' : 'Kein Abo' }}
          </button>
        </div>
      </div>
      <div class="more small">
        <button v-if="ended.length" class="btn ghost" @click="showEnded = !showEnded">{{ showEnded ? 'beendete ausblenden' : `${ended.length} beendet` }}</button>
        <button v-if="hidden.length" class="btn ghost" @click="showHidden = !showHidden">{{ hidden.length }} ausgeblendet</button>
      </div>
      <div v-if="showHidden">
        <div v-for="h in hidden" :key="h.key" class="hid small">
          <span class="faint">{{ subName(h) }} · {{ fmtEur(h.amount) }} / {{ PERIODS[h.period]?.per }}</span>
          <button class="btn ghost" @click="emit('act', 'subRestore', { key: h.key })">zurückholen</button>
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
.due { display: grid; grid-template-columns: 110px 1fr auto; gap: 10px; padding: 5px 0; border-top: 1px solid var(--line); }
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
.btn.small { font-size: 12px; padding: 4px 10px; }
.more { display: flex; gap: 6px; margin-top: 8px; }
.hid { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
</style>
