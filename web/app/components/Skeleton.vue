<script setup lang="ts">
/**
 * Placeholder shaped like what is loading, instead of "Loading…".
 * kind: lines (text), rows (list/table), tiles (app tiles), cards (panels), band (one strip of numbers)
 */
withDefaults(defineProps<{ kind?: 'lines' | 'rows' | 'tiles' | 'cards' | 'band', n?: number }>(), { kind: 'lines', n: 3 })
</script>

<template>
  <div class="sk" :class="kind" aria-busy="true" aria-label="Loading…">
    <template v-if="kind === 'lines'">
      <span v-for="i in n" :key="i" class="b line" :style="{ width: `${92 - ((i * 23) % 40)}%` }" />
    </template>
    <template v-else-if="kind === 'rows'">
      <div v-for="i in n" :key="i" class="row"><span class="b dotb" /><span class="b line" :style="{ width: `${70 - ((i * 17) % 30)}%` }" /><span class="b tag" /></div>
    </template>
    <template v-else-if="kind === 'band'">
      <span v-for="i in n" :key="i" class="b cell" />
    </template>
    <template v-else>
      <div v-for="i in n" :key="i" class="b box"><span class="b ico" /><span class="b line" /></div>
    </template>
  </div>
</template>

<style scoped>
.b { display: block; background: var(--panel-2); border-radius: 6px; position: relative; overflow: hidden; }
.b::after {
  content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / .04), transparent); animation: shimmer 1.4s infinite;
}
@keyframes shimmer { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .b::after { animation: none; } }
.line { height: 12px; }
.lines { display: flex; flex-direction: column; gap: 9px; padding: 4px 0; }
.rows { display: flex; flex-direction: column; }
.row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
.row:first-child { border-top: 0; }
.row .line { flex: none; }
.dotb { width: 8px; height: 8px; border-radius: 50%; }
.tag { width: 44px; height: 14px; margin-left: auto; border-radius: 999px; }
.tiles, .cards { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
.cards { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.box { display: flex; align-items: center; gap: 12px; padding: 12px 14px; height: 66px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
.cards .box { height: 60px; }
.box .ico { width: 38px; height: 38px; border-radius: var(--radius-sm); flex: none; }
.box .line { width: 55%; }
.band { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.band .cell { height: 62px; border-radius: 0; background: var(--panel); }
@media (max-width: 640px) {
  .tiles, .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .box { height: 56px; padding: 10px; }
  .band { grid-auto-flow: row; grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
