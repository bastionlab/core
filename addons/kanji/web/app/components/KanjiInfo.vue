<script setup lang="ts">
/** one kanji: everything on the card, stroke order and how the card is doing */
const props = defineProps<{ k: string }>()
const emit = defineEmits<{ close: [], changed: [] }>()
const x = ref<any>(null)
const error = ref('')
async function load() {
  try { x.value = await $fetch('/api/kanji/card', { query: { k: props.k } }); error.value = '' } catch (e: any) { error.value = e?.data?.statusMessage || e?.message }
}
watch(() => props.k, load, { immediate: true })

const { armed, arm } = useArm()
async function forget() {
  if (!arm('forget')) return
  try { await $fetch('/api/kanji/action', { method: 'POST', body: { action: 'forget', k: props.k } }); await load(); emit('changed') } catch (e: any) { error.value = e?.data?.statusMessage || e?.message }
}
const STATE: Record<string, string> = { learning: 'Learning', relearning: 'Relearning', review: 'Review' }
const fmt = (t: number) => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const ivl = (d: number) => (d < 30 ? `${d} d` : d < 365 ? `${(d / 30).toFixed(1)} mo` : `${(d / 365).toFixed(1)} y`)
const RATE = ['', 'Again', 'Hard', 'Good', 'Easy']
const practice = ref(0)
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet">
      <button type="button" class="btn ghost icon x" aria-label="close" @click="emit('close')">✕</button>
      <p v-if="error" class="errbox">{{ error }}</p>
      <template v-if="x">
        <div class="top">
          <div lang="ja" class="kanji">{{ x.k }}</div>
          <KanjiStrokes v-if="!practice" :k="x.k" />
          <KanjiTrace v-else :key="practice" :k="x.k" guide />
        </div>
        <div class="practice">
          <button type="button" class="btn sm" @click="practice++">✍️ {{ practice ? 'Again' : 'Practice writing' }}</button>
          <button v-if="practice" type="button" class="lnk small" @click="practice = 0">Stroke order</button>
        </div>
        <div class="pills">
          <span class="pill">N{{ x.n }}</span>
          <span class="pill">{{ x.s }} strokes</span>
          <span v-if="x.card" class="pill accent">{{ STATE[x.card.state] }}</span>
          <span v-else class="pill">New</span>
        </div>
        <KanjiFace :c="x" />
        <div v-if="x.card" class="card small muted">
          <span>Interval {{ x.card.state === 'review' ? ivl(x.card.ivl) : '–' }}</span>
          <span>Due {{ fmt(x.card.due) }}</span>
          <span>Ease {{ x.card.ease }}%</span>
          <span>{{ x.card.reps }} reviews · {{ x.card.lapses }} lapses</span>
        </div>
        <div v-if="x.write" class="card small muted">
          <span>✍️ Writing: {{ x.write.state === 'review' ? `every ${ivl(x.write.ivl)}` : STATE[x.write.state] }}</span>
          <span>{{ x.write.reps }} written · {{ x.write.lapses }} lapses</span>
        </div>
        <div v-if="x.history.length" class="hist faint small">
          <span v-for="(h, i) in x.history" :key="i" :class="{ bad: h.rating === 1 }" :title="fmt(h.ts)">{{ h.w ? '✍️' : '' }}{{ RATE[h.rating] }}</span>
        </div>
        <div class="foot">
          <a class="lnk small" :href="`https://jisho.org/search/${encodeURIComponent(x.k)}%20%23kanji`" target="_blank" rel="noopener">Jisho ↗</a>
          <button v-if="x.card" type="button" class="btn sm" :class="{ sure: armed === 'forget' }" @click="forget">{{ armed === 'forget' ? 'Sure?' : 'Reset to new' }}</button>
        </div>
      </template>
      <p v-else-if="!error" class="muted small">Loading…</p>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, .55); display: flex; justify-content: center; align-items: flex-start; padding: 5vh 16px; overflow-y: auto; }
.sheet { position: relative; width: 100%; max-width: 560px; background: var(--panel); border: 1px solid var(--line-2); border-radius: 16px; padding: 18px 20px 14px; display: flex; flex-direction: column; gap: 12px; }
.x { position: absolute; top: 8px; right: 8px; }
.top { display: flex; align-items: center; justify-content: center; gap: 24px; flex-wrap: wrap; }
.kanji { font-size: 100px; line-height: 1.1; font-family: 'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif; }
.practice { display: flex; gap: 14px; align-items: center; justify-content: center; }
.pills { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.card { display: flex; flex-wrap: wrap; gap: 4px 14px; justify-content: center; }
.hist { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.foot { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line); padding-top: 10px; }
@media (max-width: 640px) { .scrim { padding: 12px 8px; } .sheet { padding: 16px 14px 12px; } }
</style>
