<script setup lang="ts">
/** write a whole word from memory: its kanji one after another on the pad, the kana are given */
const props = defineProps<{ form: string }>()
const emit = defineEmits<{ done: [{ mistakes: number, hints: number }] }>()
const isKanji = (c: string) => /[一-鿿々]/.test(c)
const chars = computed(() => [...props.form])
const todo = computed(() => chars.value.map((c, i) => (isKanji(c) && c !== '々' ? i : -1)).filter(i => i >= 0))
const at = ref(0) // index into todo
const sum = { mistakes: 0, hints: 0 }
const pad = ref<any>()
watch(() => props.form, () => { at.value = 0; sum.mistakes = 0; sum.hints = 0 })

function next(r: { mistakes: number, hints: number }) {
  sum.mistakes += r.mistakes; sum.hints += r.hints
  // a beat to see the finished kanji before the pad moves on
  setTimeout(() => { at.value++; if (at.value >= todo.value.length) emit('done', { ...sum }) }, 350)
}
const current = computed(() => todo.value[at.value] ?? -1)
// written so far (々 just repeats the kanji before it, so it shows with it)
const shown = (i: number) => !isKanji(chars.value[i]!) || current.value < 0 || i < current.value
const hint = () => pad.value?.hint()
/** give up: the whole word shows */
const reveal = () => { at.value = todo.value.length }
defineExpose({ hint, reveal })
</script>

<template>
  <div class="write">
    <div lang="ja" class="word">
      <span v-for="(c, i) in chars" :key="i" :class="{ box: isKanji(c), cur: i === current, ok: isKanji(c) && shown(i) }">{{ shown(i) ? c : '' }}</span>
    </div>
    <KanjiTrace v-if="current >= 0" ref="pad" :key="current" :k="chars[current]!" @done="next" />
  </div>
</template>

<style scoped>
.write { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.word { display: flex; gap: 4px; font-size: 30px; line-height: 1; }
.word span { min-width: 1em; text-align: center; }
.box { width: 1.25em; height: 1.25em; display: grid; place-items: center; border: 1px dashed var(--line-2); border-radius: 6px; }
.box.cur { border: 2px solid var(--accent); }
.box.ok { border: 1px solid transparent; color: var(--ok); }
</style>
