<script setup lang="ts">
/** checked: show when the flat was last seen online (the Gemerkt list) */
const props = defineProps<{ item: any, busy?: boolean, checked?: boolean }>()
const emit = defineEmits<{ (e: 'verdict', v: 'up' | 'down' | null): void }>()

const SOURCES: Record<string, string> = { kleinanzeigen: 'Kleinanzeigen', inberlinwohnen: 'inberlinwohnen', immoscout24: 'ImmoScout24', bienici: "Bien'ici" }
const eur = (v?: number | null) => (v == null ? '' : `${Math.round(v).toLocaleString('de-DE')} €`)

const warm = computed(() => props.item.warm == null ? (props.item.list_price ? eur(props.item.list_price) : '—') : eur(props.item.warm))
// what the warm figure is made of, so an estimate never passes for a quote
const breakdown = computed(() => {
  const i = props.item
  const bits = [i.cold && `${eur(i.cold)} cold`, i.extra != null && `${eur(i.extra)} utilities`, i.heating && `${eur(i.heating)} heating`].filter(Boolean)
  if (i.warm_kind === 'stated') return bits.length ? `warm per ad · ${bits.join(' + ')}` : 'warm per ad'
  if (i.warm_kind === 'sum') return bits.join(' + ')
  if (i.warm_kind === 'estimated') return `estimated${bits.length ? ' · ' + bits.join(' + ') : ''}`
  return i.list_price ? 'price per ad, warm unclear' : 'rent unclear'
})
const when = computed(() => vor(props.item.posted_at ?? props.item.first_seen_at))
const fresh = computed(() => (Date.now() / 1000 - (props.item.posted_at ?? 0)) < 6 * 3600)
const channels = computed(() => (props.item.contact?.channels ?? []).filter((c: any) => c.type === 'email' || c.type === 'phone'))
const phoneText = (v: string) => v.replace(/^\+49/, '0').replace(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '0$1 $2 $3 $4 $5')
const vote = (v: 'up' | 'down') => emit('verdict', props.item.verdict === v ? null : v)

// 💬: a draft written in CT 107 from the "Über uns" profile, cached there per flat
const msg = reactive({ open: false, loading: false, text: '', missing: [] as string[], err: '', copied: false })
async function draft(fresh = false) {
  msg.open = true; msg.loading = true; msg.err = ''
  try {
    const r = await $fetch<any>('/api/flats/action', {
      method: 'POST', body: { action: 'message', source: props.item.source, sourceId: props.item.source_id, searchId: props.item.search_id, fresh },
    })
    msg.text = r.text; msg.missing = r.missing ?? []
  } catch (e: any) { msg.err = errText(e) } finally { msg.loading = false }
}
function toggleMsg() {
  if (msg.open) { msg.open = false; return }
  if (msg.text) msg.open = true
  else draft()
}
const ta = ref<HTMLTextAreaElement | null>(null)
async function copy() {
  try { await navigator.clipboard.writeText(msg.text) } catch {
    // plain http or an old browser: the selection route still works inside a click
    ta.value?.select(); document.execCommand('copy')
  }
  msg.copied = true
  setTimeout(() => { msg.copied = false }, 2500)
}
</script>

<template>
  <article class="flat" :class="{ out: item.passed === 0 || item.verdict === 'down' || item.status === 'reserved', gone: item.status === 'gone' }">
    <a :href="item.url" target="_blank" rel="noopener" class="shot">
      <img v-if="item.image_url" :src="item.image_url" :alt="item.title" loading="lazy">
      <span v-else>🏠</span>
    </a>

    <div class="main">
      <a :href="item.url" target="_blank" rel="noopener" class="title">{{ item.title }}</a>
      <div class="facts">
        <b v-if="item.rooms">{{ item.rooms.toLocaleString('de-DE') }} rooms</b>
        <b v-if="item.area">{{ item.area.toLocaleString('de-DE') }} m²</b>
        <span v-if="item.district" class="muted">{{ item.district }}</span>
        <span v-if="item.distance_km != null" class="muted">{{ item.distance_km.toLocaleString('de-DE') }} km</span>
        <span v-if="item.available_from" class="muted">from {{ item.available_from }}</span>
      </div>
      <div class="pills">
        <span class="pill">{{ SOURCES[item.source] ?? item.source }}</span>
        <!-- the same flat seen elsewhere, folded into this card by the hunter -->
        <a v-for="d in item.dupes ?? []" :key="d.source + d.source_id" :href="d.url" target="_blank" rel="noopener"
           class="pill ghost" title="Same ad, also found there">also {{ SOURCES[d.source] ?? d.source }} ↗</a>
        <span v-if="item.wbs === 1" class="pill warn">WBS required</span>
        <span v-else-if="item.wbs === 0 && item.source === 'inberlinwohnen'" class="pill">no WBS</span>
        <span v-if="item.tausch === 1" class="pill warn">Swap</span>
        <!-- when the match is aussortiert, its reason already names the kind -->
        <template v-if="item.passed !== 0">
          <span v-if="item.kind === 'zwischenmiete'" class="pill warn">Sublet</span>
          <span v-if="item.kind === 'wg_zimmer'" class="pill warn">Shared-flat room</span>
        </template>
        <span v-if="item.scam === 'mittel'" class="pill warn" title="The AI noticed red flags">⚠ check</span>
        <span v-if="item.status === 'reserved'" class="pill warn">Reserved</span>
        <span v-if="item.status === 'gone'" class="pill bad">offline{{ item.gone_at ? ` · ${vor(item.gone_at)}` : '' }}</span>
        <span v-if="item.passed === 0 && item.reason" class="pill bad">{{ item.reason }}</span>
        <span class="pill ghost">{{ item.search_name }}</span>
      </div>
      <div v-if="item.ai_note" class="small muted note">✦ {{ item.ai_note }}</div>
      <div class="contact small">
        <span class="muted">{{ item.contact?.how }}<template v-if="item.contact?.name && !item.contact.how?.includes(item.contact.name)"> · {{ item.contact.name }}</template></span>
        <a v-for="c in channels" :key="c.value" :href="c.type === 'email' ? `mailto:${c.value}` : `tel:${c.value}`" class="chan">
          {{ c.type === 'email' ? '✉' : '☎' }} {{ c.type === 'email' ? c.value : phoneText(c.value) }}
        </a>
      </div>
    </div>

    <div class="side">
      <div class="warm" :class="{ est: item.warm_kind === 'estimated' || item.warm == null }">{{ warm }}</div>
      <div class="small muted bd">{{ breakdown }}</div>
      <div class="small" :class="fresh ? 'accent' : 'muted'">{{ when }}</div>
      <div v-if="checked && item.status !== 'gone'" class="small faint" title="last checked whether the ad is still online">
        {{ item.checked_at ? `✓ checked ${vor(item.checked_at)}` : 'not checked yet' }}
      </div>
      <div class="votes">
        <button class="btn ghost" :class="{ on: msg.open }" title="Message to the landlord" @click="toggleMsg">💬</button>
        <button class="btn ghost" :class="{ on: item.verdict === 'up' }" :disabled="busy" title="Interesting" @click="vote('up')">👍</button>
        <button class="btn ghost" :class="{ on: item.verdict === 'down' }" :disabled="busy" title="Not for me" @click="vote('down')">👎</button>
      </div>
    </div>

    <div v-if="msg.open" class="msg">
      <div v-if="msg.loading" class="small muted">✦ writing a message for this ad…</div>
      <div v-else-if="msg.err" class="small bad">{{ msg.err }}</div>
      <template v-else>
        <textarea ref="ta" v-model="msg.text" rows="14" class="ta" />
        <div v-if="msg.missing.length" class="small warn">Ad asks for this, not in the profile: {{ msg.missing.join(', ') }}</div>
      </template>
      <div class="msgbar">
        <button class="btn ghost" :disabled="msg.loading" title="Rewrite" @click="draft(true)">↻ Rewrite</button>
        <!-- the <a> opens the ad natively (no popup blocker); the click also puts the text on the clipboard -->
        <a v-if="msg.text && !msg.loading" :href="item.url" target="_blank" rel="noopener" class="btn" @click="copy">Copy &amp; open ad</a>
        <button class="btn primary" :disabled="!msg.text || msg.loading" @click="copy">{{ msg.copied ? '✓ Copied' : 'Copy' }}</button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.flat { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 12px; padding: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
.flat.out { opacity: .55; }
.flat.gone { opacity: .45; }
.flat.gone .title { text-decoration: line-through; }
.shot { width: 96px; height: 72px; border-radius: var(--radius-sm); overflow: hidden; background: var(--panel-2); display: grid; place-items: center; font-size: 26px; }
.shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.shot span { opacity: .4; }
.main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.title { font-weight: 600; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facts { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 12.5px; }
.pills { display: flex; flex-wrap: wrap; gap: 4px; }
.pill.ghost { background: transparent; border: 1px solid var(--line); }
.note { line-height: 1.3; }
.contact { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: center; }
.chan { white-space: nowrap; }
.side { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; text-align: right; min-width: 120px; }
.warm { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.warm.est { color: var(--warn); }
.bd { max-width: 190px; line-height: 1.3; }
.accent { color: var(--accent); font-weight: 600; }
.msg { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line); padding-top: 10px; }
.msg .ta { width: 100%; box-sizing: border-box; padding: 10px 12px; line-height: 1.45; resize: vertical; }
.msgbar { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.votes { margin-top: auto; display: flex; gap: 2px; }
.votes .btn { padding: 3px 6px; font-size: 13px; }
.votes .btn.on { background: var(--accent-soft); }
@media (pointer: coarse) { .votes { gap: 6px; } .votes .btn { min-width: 34px; min-height: 34px; } }
@media (max-width: 640px) {
  .flat { grid-template-columns: 64px minmax(0, 1fr); }
  .shot { width: 64px; height: 56px; }
  .side { grid-column: 1 / -1; flex-direction: row; align-items: center; justify-content: space-between; text-align: left; min-width: 0; flex-wrap: wrap; }
  .bd { max-width: none; flex: 1; }
  .votes { margin-top: 0; }
  .title { white-space: normal; }
}
</style>
