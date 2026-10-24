<script setup lang="ts">
/** the back of a card: meanings, readings, example words (shared by the study screen and the info sheet) */
import type { KanjiCard } from '../utils/kanji'
defineProps<{ c: KanjiCard }>()
</script>

<template>
  <div class="face">
    <div class="mean">{{ c.m.join(', ') }}</div>
    <div class="reads">
      <div v-if="c.on.length"><span class="lab faint small">On</span><span lang="ja" class="jp">{{ c.on.map(kata).join('、') }}</span></div>
      <div v-if="c.kun.length">
        <span class="lab faint small">Kun</span>
        <span lang="ja" class="jp"><template v-for="(r, i) in c.kun" :key="r">{{ i ? '、' : '' }}{{ kun(r).stem }}<span v-if="kun(r).oku" class="faint">{{ kun(r).oku }}</span></template></span>
      </div>
    </div>
    <ul v-if="c.w.length" class="words">
      <li v-for="[w, r, g] in c.w" :key="w">
        <span lang="ja" class="w">{{ w }}</span>
        <span lang="ja" class="r muted">{{ r }}</span>
        <span class="g">{{ g }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.face { display: flex; flex-direction: column; gap: 12px; }
.mean { font-size: 20px; font-weight: 600; text-align: center; }
.reads { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.reads > div { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; justify-content: center; }
.lab { width: 28px; text-align: right; }
.jp { font-size: 17px; }
.words { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-top: 1px solid var(--line); }
.words li { display: grid; grid-template-columns: auto auto 1fr; gap: 4px 10px; align-items: baseline; padding: 7px 2px; border-bottom: 1px solid var(--line); }
.w { font-size: 18px; }
.r { font-size: 13px; }
.g { font-size: 13px; color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .words li { grid-template-columns: auto 1fr; }
  .g { grid-column: 1 / -1; }
}
</style>
