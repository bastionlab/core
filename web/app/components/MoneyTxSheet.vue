<script setup lang="ts">
/** one booking: change its category, see everything else with that payee, and tick the charges that make up a subscription */
const props = defineProps<{ tx: any, categories: string[], subs?: any[] }>()
const emit = defineEmits<{ close: [], category: [any, string, 'one' | 'payee'], changed: [] }>()

const p = ref<any>(null)
const err = ref('')
const picked = ref<Set<string>>(new Set())
const period = ref('')
const name = ref('')
const busy = ref(false)
const msg = ref('')

async function load() {
  p.value = null; err.value = ''; msg.value = ''
  try {
    p.value = await $fetch('/api/money/payee', { query: { name: props.tx.payee } })
    // preselect the bookings that look like the same subscription / regular income: same payee and direction,
    // amount within 25 % (income also on the same account: Taschengeld on DKB, not the odd PayPal)
    const a = Math.abs(props.tx.amount), inc = props.tx.amount > 0
    picked.value = new Set(p.value.transactions.filter((t: any) => (t.amount > 0) === inc && Math.abs(Math.abs(t.amount) - a) <= 0.25 * a &&
      (!inc || t.account === props.tx.account) && !['Umbuchung', 'Investments'].includes(t.category)).map((t: any) => t.journal_id))
  } catch (e: any) { err.value = e?.data?.statusMessage || e?.message }
}
watch(() => props.tx.journal_id, load, { immediate: true })

// a new category asks: just this booking, or every booking with this payee (same direction) + future ones
const pendingCat = ref('')
watch(() => props.tx.journal_id, () => (pendingCat.value = ''))
const samePayee = computed(() => (p.value?.transactions ?? []).filter((t: any) => (t.amount > 0) === (props.tx.amount > 0) && !['Umbuchung', 'Investments'].includes(t.category)).length)
function pickCat(c: string) {
  if (c === props.tx.category) { pendingCat.value = ''; return }
  if (samePayee.value > 1) pendingCat.value = c
  else emit('category', props.tx, c, 'one')
}
function applyCat(scope: 'one' | 'payee') {
  const c = pendingCat.value
  pendingCat.value = ''
  emit('category', props.tx, c, scope)
  if (scope === 'payee' && p.value) {
    for (const t of p.value.transactions) if ((t.amount > 0) === (props.tx.amount > 0) && !['Umbuchung', 'Investments'].includes(t.category)) t.category = c
    msg.value = `✓ ${samePayee.value} Buchungen mit ${shown.value} → ${c}, künftige auch`
  }
}

// a readable name for the payee, shown everywhere (the bank's stays underneath)
const shown = computed(() => props.tx.alias || props.tx.payee)
const renaming = ref(false)
const alias = ref('')
const renBox = ref<HTMLInputElement>()
function startRename() { alias.value = props.tx.alias || ''; renaming.value = true; nextTick(() => renBox.value?.focus()) }
async function saveRename() {
  renaming.value = false
  if ((props.tx.alias || '') === alias.value.trim()) return
  try {
    await $fetch('/api/money/action', { method: 'POST', body: { action: 'rename', name: props.tx.payee, alias: alias.value.trim() } })
    props.tx.alias = alias.value.trim() || null  // eslint-disable-line vue/no-mutating-props
    emit('changed')
  } catch (e: any) { msg.value = e?.data?.statusMessage || e?.message }
}

function toggle(t: any) {
  const s = new Set(picked.value)
  // one direction at a time: charges make an Abo, deposits a regular income or a share of one
  for (const x of p.value?.transactions ?? []) if ((x.amount > 0) !== (t.amount > 0)) s.delete(x.journal_id)
  s.has(t.journal_id) ? s.delete(t.journal_id) : s.add(t.journal_id)
  picked.value = s
}
const abos = computed(() => props.subs ?? [])
const pickedIn = computed(() => (p.value?.transactions ?? []).some((t: any) => picked.value.has(t.journal_id) && t.amount > 0))
async function saveShare(key: string) {
  if (!key) return
  busy.value = true; msg.value = ''
  try {
    await $fetch('/api/money/action', { method: 'POST', body: { action: 'subShare', key, journalIds: [...picked.value] } })
    msg.value = `✓ Als Anteil an ${subName(abos.value.find(s => s.key === key) ?? {})} verrechnet`
    emit('changed')
    await load()
  } catch (e: any) { msg.value = e?.data?.statusMessage || e?.message } finally { busy.value = false }
}
const pickedSum = computed(() => (p.value?.transactions ?? []).filter((t: any) => picked.value.has(t.journal_id)).reduce((a: number, t: any) => a + t.amount, 0))
async function saveSub() {
  busy.value = true; msg.value = ''
  try {
    const r: any = await $fetch('/api/money/action', { method: 'POST', body: { action: 'subAdd', journalIds: [...picked.value], period: period.value || null, name: name.value || null } })
    msg.value = `✓ Als ${r.kind === 'in' ? 'Einnahme' : 'Abo'} gespeichert (${PERIODS[r.period]?.label ?? r.period})`
    emit('changed')
    await load()
  } catch (e: any) { msg.value = e?.data?.statusMessage || e?.message } finally { busy.value = false }
}
const months = computed(() => (p.value?.months ?? []).slice(-12))
const mMax = computed(() => Math.max(1, ...months.value.map((m: any) => Math.abs(m.amount))))
const subs = computed(() => (p.value?.subs ?? []).filter((s: any) => !s.dismissed))
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet">
      <header>
        <div class="tt">
          <span v-if="!renaming" class="py">{{ shown }} <button class="lnk small" title="Anzeigenamen ändern" @click="startRename">✎</button></span>
          <span v-else class="ren">
            <input ref="renBox" v-model="alias" :placeholder="tx.payee" maxlength="60" @keydown.enter="saveRename" @keydown.esc="renaming = false">
            <button class="btn primary small" @click="saveRename">OK</button>
          </span>
          <span v-if="tx.alias || renaming" class="faint small">Bank: {{ tx.payee }}</span>
          <span class="faint small">{{ tx.date ? dayTitle(tx.date) : '' }}{{ tx.account ? ` · ${tx.account}` : '' }}</span>
        </div>
        <span class="num big" :class="tx.amount > 0 ? 'ok' : ''">{{ fmtEur(tx.amount) }}</span>
        <button class="btn ghost x" title="schließen" @click="emit('close')">✕</button>
      </header>
      <p v-if="tx.description && tx.description !== tx.payee" class="small muted desc">{{ tx.description }}</p>
      <label v-if="!String(tx.journal_id).startsWith('sub:')" class="row small"><span class="muted">Kategorie</span>
        <select :value="pendingCat || tx.category" @change="pickCat(($event.target as HTMLSelectElement).value)">
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <div v-if="pendingCat" class="scope">
        <span class="small">{{ pendingCat }} für…</span>
        <button class="btn primary" @click="applyCat('payee')">Alle {{ samePayee }} mit {{ shown }}<span class="faint2"> + künftige</span></button>
        <button class="btn" @click="applyCat('one')">Nur diese</button>
        <button class="btn ghost" @click="pendingCat = ''">Abbrechen</button>
      </div>

      <div v-if="err" class="bad small">{{ err }}</div>
      <div v-else-if="!p" class="faint small">Lade Verlauf…</div>
      <template v-else>
        <div class="stats small">
          <span>{{ p.count }} Buchungen</span>
          <span>12 Monate: <b class="num">{{ fmtEur(p.total_12m, 0) }}</b></span>
          <span v-for="s in subs" :key="s.key" class="pill accent">{{ s.kind === 'in' ? 'Einnahme' : 'Abo' }} · {{ fmtEur(s.amount) }} / {{ PERIODS[s.period]?.per }}</span>
          <span v-if="tx.share_of" class="pill accent">Anteil an {{ tx.share_of }}</span>
        </div>
        <div v-if="months.length > 1" class="mbars">
          <span v-for="m in months" :key="m.month" class="mb" :title="`${monthTitle(m.month)}: ${fmtEur(m.amount)}`">
            <i :class="m.amount > 0 ? 'in' : ''" :style="{ height: (100 * Math.abs(m.amount) / mMax) + '%' }" />
          </span>
        </div>

        <h3 class="small muted">Alle Buchungen mit {{ shown }} <span class="faint">– haken = gehört zum Abo / zur Einnahme</span></h3>
        <div class="list">
          <label v-for="t in p.transactions" :key="t.journal_id" class="li" :class="{ cur: t.journal_id === tx.journal_id }">
            <input type="checkbox" :checked="picked.has(t.journal_id)" @change="toggle(t)">
            <span class="faint small dt">{{ new Date(t.date + 'T12:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) }}</span>
            <span class="small ds">{{ t.description }}</span>
            <span class="num small" :class="t.amount > 0 ? 'ok' : ''">{{ fmtEur(t.amount) }}</span>
          </label>
        </div>

        <div class="abo">
          <span class="small">{{ picked.size }} ausgewählt<span v-if="picked.size" class="faint"> · Ø {{ fmtEur(Math.abs(pickedSum) / picked.size) }}</span></span>
          <select v-model="period" class="small">
            <option value="">Rhythmus: automatisch</option>
            <option v-for="(v, k) in PERIODS" :key="k" :value="k">{{ v.label }}</option>
          </select>
          <input v-model="name" class="small nm" placeholder="Name (optional)" maxlength="80">
          <button class="btn primary" :disabled="!picked.size || busy" @click="saveSub">{{ pickedIn ? 'Als Einnahme speichern' : 'Als Abo speichern' }}</button>
          <select v-if="pickedIn && abos.length" class="small" value="" :disabled="busy" @change="saveShare(($event.target as HTMLSelectElement).value)">
            <option value="" disabled>…oder Anteil an Abo</option>
            <option v-for="s in abos" :key="s.key" :value="s.key">{{ subName(s) }}</option>
          </select>
        </div>
        <p v-if="msg" class="small" :class="msg.startsWith('✓') ? 'ok' : 'bad'">{{ msg }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, .55); display: flex; justify-content: center; align-items: flex-start; padding: 6vh 16px; overflow-y: auto; }
.sheet { width: 100%; max-width: 640px; background: var(--panel); border: 1px solid var(--line-2); border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
header { display: flex; align-items: flex-start; gap: 10px; }
.tt { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.py { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.big { font-size: 18px; font-weight: 600; }
.x { padding: 2px 8px; }
.desc { margin: 0; overflow-wrap: anywhere; }
.row { display: flex; align-items: center; gap: 10px; }
.row select { padding: 4px 8px; }
.ren { display: flex; gap: 6px; }
.ren input { flex: 1; min-width: 0; padding: 4px 8px; }
.lnk { border: 0; background: none; padding: 0 2px; color: var(--accent); cursor: pointer; font: inherit; }
.btn.small { font-size: 12px; padding: 4px 10px; }
.scope { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px; border: 1px solid var(--accent); border-radius: 10px; background: var(--accent-soft); }
.scope .btn.primary { white-space: normal; text-align: left; }
.faint2 { font-weight: 400; opacity: .75; }
.stats { display: flex; gap: 6px 14px; flex-wrap: wrap; align-items: center; color: var(--muted); }
.stats b { color: var(--text); }
.mbars { display: flex; gap: 3px; height: 44px; align-items: flex-end; }
.mb { flex: 1; height: 100%; display: flex; align-items: flex-end; }
.mb i { display: block; width: 100%; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 2px; }
.mb i.in { background: var(--ok); }
h3 { margin: 4px 0 0; font-weight: 500; }
.list { max-height: 40vh; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; }
.li { display: grid; grid-template-columns: 22px 64px 1fr auto; gap: 8px; align-items: center; padding: 6px 10px; border-top: 1px solid var(--line); cursor: pointer; }
.li:first-child { border-top: 0; }
.li.cur { background: var(--accent-soft); }
.ds { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.abo { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.abo select, .abo .nm { padding: 5px 8px; }
.abo .nm { flex: 1; min-width: 120px; }
@media (max-width: 640px) { .scrim { padding: 0; align-items: stretch; } .sheet { border-radius: 0; min-height: 100%; padding-top: calc(14px + env(safe-area-inset-top)); } }
</style>
