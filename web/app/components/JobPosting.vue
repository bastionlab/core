<script setup lang="ts">
const props = defineProps<{ item: any, busy?: boolean }>()
const emit = defineEmits<{ (e: 'verdict', v: 'up' | 'down' | null): void, (e: 'applied', v: boolean): void }>()

const MODE: Record<string, string> = { onsite: 'Vor Ort', hybrid: 'Hybrid', remote: 'Remote' }
const LEVEL: Record<string, string> = { junior: 'Junior', mid: 'Mid', senior: 'Senior', lead: 'Lead' }
const GERMAN: Record<string, string> = { keins: 'kein Deutsch nötig', grundkenntnisse: 'etwas Deutsch', gut: 'gutes Deutsch', fliessend: 'fließend Deutsch' }

const k = (v: number) => `${Math.round(v / 1000)}k`
const salary = computed(() => {
  const i = props.item
  if (i.salary_min && i.salary_max && i.salary_min !== i.salary_max) return `${k(i.salary_min)}–${k(i.salary_max)} €`
  if (i.salary_min || i.salary_max) return `${k(i.salary_min || i.salary_max)} €`
  return i.salary_said || ''
})
const when = computed(() => vor(props.item.posted_at ?? props.item.first_seen_at))
const fresh = computed(() => (Date.now() / 1000 - (props.item.posted_at ?? props.item.first_seen_at ?? 0)) < 86400)
const fitTone = computed(() => {
  const f = props.item.fit
  return f == null ? '' : f >= 80 ? 'ok' : f >= 60 ? 'accent' : 'warn'
})

// where to apply: the employer's own channel when one was found, else the portal posting
const apply = computed(() => {
  const a = props.item.apply ?? {}
  const url = a.url || props.item.url
  const ch = a.channel || 'portal'
  const label = ch === 'email' ? 'per E-Mail' : ch === 'portal' ? `auf ${a.label || props.item.source_label}` : `über ${a.label || ch}`
  return { url, ch, label, email: a.email, via: a.via }
})
const vote = (v: 'up' | 'down') => emit('verdict', props.item.verdict === v ? null : v)
</script>

<template>
  <article class="job" :class="{ out: item.passed === 0 || item.verdict === 'down', done: item.applied_at }">
    <div class="fit" :class="fitTone" :title="item.fit == null ? 'noch nicht bewertet' : 'Match mit Lebenslauf und Wunsch'">
      <b>{{ item.fit ?? '…' }}</b>
    </div>

    <div class="main">
      <a :href="item.url" target="_blank" rel="noopener" class="title" :title="item.title">{{ item.title }}</a>
      <div class="facts">
        <b v-if="item.company">{{ item.company }}</b>
        <span v-if="item.location" class="muted loc" :title="item.location">{{ item.location }}</span>
        <span v-if="item.distance_km != null && item.mode !== 'remote'" class="muted">{{ item.distance_km.toLocaleString('de-DE') }} km</span>
        <span v-if="salary" class="sal">{{ salary }}</span>
      </div>
      <div class="pills">
        <span v-if="item.mode" class="pill" :class="{ acc: item.mode === 'remote' }">{{ MODE[item.mode] }}<template v-if="item.mode === 'remote' && item.remote_region"> · {{ item.remote_region }}</template></span>
        <span v-if="item.level" class="pill">{{ LEVEL[item.level] }}</span>
        <span v-for="e in (item.employment ?? []).filter((x: string) => x !== 'vollzeit')" :key="e" class="pill">{{ e }}</span>
        <span v-if="item.german" class="pill ghost">{{ GERMAN[item.german] ?? item.german }}</span>
        <span v-if="item.agency" class="pill warn">Vermittler</span>
        <span v-if="item.passed === 0 && item.reason" class="pill bad">{{ item.reason }}</span>
        <span class="pill ghost">{{ item.search_name }}</span>
      </div>
      <div v-if="item.pros?.length || item.gaps?.length" class="why small">
        <span v-for="p in item.pros" :key="'p' + p" class="pro">✓ {{ p }}</span>
        <span v-for="g in item.gaps" :key="'g' + g" class="gap">✗ {{ g }}</span>
      </div>
      <div v-if="item.passed !== 0 && item.reason" class="small muted note">✦ {{ item.reason }}</div>
      <div class="small src">
        <a :href="item.url" target="_blank" rel="noopener" class="muted">{{ item.source_label }}</a>
        <a v-for="a in item.also" :key="a.source + a.url" :href="a.url" target="_blank" rel="noopener" class="muted">· {{ a.label }}</a>
        <span v-if="item.how" class="faint how" :title="item.how">· {{ item.how }}</span>
      </div>
    </div>

    <div class="side">
      <div class="small" :class="fresh ? 'accent' : 'muted'">{{ when }}</div>
      <a class="btn primary go" :href="apply.url" target="_blank" rel="noopener" :title="apply.via === 'search' ? 'auf der Seite des Arbeitgebers gefunden' : apply.url">
        Bewerben ↗
      </a>
      <span class="small muted chan">{{ apply.label }}</span>
      <a v-if="apply.email && apply.ch !== 'email'" :href="`mailto:${apply.email}`" class="small chan">✉ {{ apply.email }}</a>
      <div class="votes">
        <button class="btn ghost" :class="{ on: item.applied_at }" :disabled="busy" :title="item.applied_at ? `beworben ${vor(item.applied_at)} – zurücknehmen` : 'als beworben markieren'" @click="emit('applied', !item.applied_at)">
          {{ item.applied_at ? '✓ beworben' : '✓' }}
        </button>
        <button class="btn ghost" :class="{ on: item.verdict === 'up' }" :disabled="busy" title="Merken" @click="vote('up')">👍</button>
        <button class="btn ghost" :class="{ on: item.verdict === 'down' }" :disabled="busy" title="Nicht für mich" @click="vote('down')">👎</button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.job { display: grid; grid-template-columns: 46px minmax(0, 1fr) auto; gap: 12px; padding: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
.job.out { opacity: .55; }
.job.done { border-color: var(--accent-soft); }
.fit { width: 46px; height: 46px; border-radius: 10px; display: grid; place-items: center; background: var(--panel-2); color: var(--muted); font-variant-numeric: tabular-nums; }
.fit b { font-size: 17px; }
.fit.ok { background: var(--ok-soft); color: var(--ok); }
.fit.accent { background: var(--accent-soft); color: var(--accent); }
.fit.warn { background: var(--warn-soft); color: var(--warn); }
.main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.title { font-weight: 600; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facts { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 12.5px; }
.loc { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sal { font-weight: 600; font-variant-numeric: tabular-nums; }
.pills { display: flex; flex-wrap: wrap; gap: 4px; }
.pill.ghost { background: transparent; border: 1px solid var(--line); }
.pill.acc { background: var(--accent-soft); color: var(--accent); }
.why { display: flex; flex-wrap: wrap; gap: 2px 12px; }
.pro { color: var(--ok); }
.gap { color: var(--warn); }
.note { line-height: 1.3; }
.src { display: flex; flex-wrap: wrap; gap: 0 5px; min-width: 0; }
.how { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
.side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right; min-width: 130px; }
.go { white-space: nowrap; }
.chan { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.accent { color: var(--accent); font-weight: 600; }
.votes { margin-top: auto; display: flex; gap: 2px; }
.votes .btn { padding: 3px 6px; font-size: 13px; }
.votes .btn.on { background: var(--accent-soft); color: var(--accent); }
@media (max-width: 640px) {
  .job { grid-template-columns: 40px minmax(0, 1fr); }
  .fit { width: 40px; height: 40px; }
  .side { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-start; text-align: left; min-width: 0; gap: 6px 10px; }
  .votes { margin: 0 0 0 auto; }
  .title { white-space: normal; }
}
</style>
