<script setup lang="ts">
/**
 * one card in Home's "Sections" grid; add-ons render it from their Home<Id>.global.vue (addon.yaml `home: true`).
 * It fills the tile the Home layout gives it and shows what fits, by the tile's own width and height
 * (container queries on HomeItem's `tile`): narrow = icon over name, short = one line with the first chip,
 * wide = every chip, tall = chips + the `more` rows, as many as there is room for.
 */
defineProps<{
  to: string, icon: string, name: string, sub?: string, chips?: { text: string, tone?: string }[]
  /** detail rows (newest notes, latest deals, …) for tall tiles */
  more?: { text: string, sub?: string, tone?: string }[]
}>()
const skinned = useSkinned('TopicCard')
</script>

<template>
  <component :is="skinned" v-if="skinned" v-bind="$props" />
  <NuxtLink v-else :to="to" class="topic">
    <span class="hd">
      <span class="ti"><Icon :name="icon" :size="18" /></span>
      <span class="txt">
        <span class="name">{{ name }}</span>
        <span class="line" :class="chips?.[0]?.tone">{{ chips?.[0]?.text ?? sub }}</span>
      </span>
      <span v-if="chips?.length" class="chips">
        <span v-for="c in chips" :key="c.text" class="pill" :class="c.tone">{{ c.text }}</span>
      </span>
      <Icon name="arrow" :size="16" class="go" />
    </span>
    <span v-if="chips?.length" class="chips below">
      <span v-for="c in chips" :key="c.text" class="pill" :class="c.tone">{{ c.text }}</span>
    </span>
    <span v-if="sub" class="sub">{{ sub }}</span>
    <span v-if="more?.length" class="more">
      <span v-for="(r, i) in more" :key="i" class="row">
        <span class="rt" :class="r.tone">{{ r.text }}</span>
        <span v-if="r.sub" class="rs">{{ r.sub }}</span>
      </span>
    </span>
    <span v-if="chips?.some(c => c.tone)" class="dot st" :class="chips.find(c => c.tone === 'bad' || c.tone === 'warn')?.tone ?? 'ok'" />
  </NuxtLink>
</template>

<style scoped>
.topic {
  position: relative; display: flex; flex-direction: column; justify-content: center; gap: 8px; min-width: 0; height: 100%;
  padding: 12px 14px; overflow: hidden;
  border-radius: var(--radius); color: var(--text); background: var(--panel); border: 1px solid var(--line);
  transition: border-color .15s, background .15s;
}
.topic:hover { text-decoration: none; border-color: var(--line-2); background: var(--panel-2); }
.hd { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ti { width: 34px; height: 34px; border-radius: var(--radius-sm); display: grid; place-items: center; background: var(--panel-2); color: var(--muted); flex: none; }
.topic:hover .ti { color: var(--accent); }
.txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line { display: none; font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line.warn { color: var(--warn); }
.line.bad { color: var(--bad); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.hd .chips { flex-wrap: nowrap; justify-content: flex-end; overflow: hidden; max-width: 65%; }
.chips.below { display: none; }
.go { color: var(--faint); flex: none; }
.hd .chips ~ .go { display: none; }
/* no chips: the sub line sits under the name */
.hd:not(:has(.chips)) .line { display: block; }
.sub { display: none; font-size: 12px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.more { display: none; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; border-top: 1px solid var(--line); padding-top: 6px; }
.row { display: flex; gap: 10px; align-items: baseline; padding: 3px 0; min-width: 0; font-size: 13px; }
.rt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs { margin-left: auto; flex: none; font-size: 12px; color: var(--faint); }
.st { display: none; position: absolute; top: 8px; right: 8px; width: 7px; height: 7px; box-shadow: none; }

/* The default above is the short, wide card: icon, name, every chip on the right. The rest follows the Home
   tile's own size (HomeItem's container `tile`). */
/* short and not wide: the first chip (or the sub line) goes under the name instead */
@container tile (max-height: 99px) and (max-width: 299px) {
  .topic { padding: 8px 12px; }
  .hd { gap: 10px; }
  .line { display: block; }
  .hd .chips { display: none; }
  .go { display: none; }
}
/* tall: header, chips, sub line, then the detail rows fill what is left */
@container tile (min-height: 100px) {
  .topic { justify-content: flex-start; }
  .line { display: none !important; }
  .hd .chips { display: none; }
  .hd .chips ~ .go { display: block; }
  .chips.below { display: flex; }
  .sub { display: block; }
  .more { display: flex; }
}
@container tile (min-height: 200px) and (min-width: 260px) {
  .ti { width: 40px; height: 40px; }
  .name { font-size: 16px; }
  .row { font-size: 14px; padding: 4px 0; }
}
/* narrow (one column): icon over name, the status as a dot; tall enough → the chips stacked under it */
@container tile (max-width: 129px) {
  .topic { align-items: center; justify-content: center; gap: 6px; padding: 8px 6px; text-align: center; }
  .hd { flex-direction: column; gap: 6px; max-width: 100%; }
  .txt { align-items: center; max-width: 100%; }
  .name { font-size: 12px; }
  .line, .hd .chips, .go, .hd .chips ~ .go, .sub, .more, .chips.below { display: none; }
  .st { display: block; }
}
@container tile (max-width: 129px) and (min-height: 140px) {
  .chips.below { display: flex; flex-direction: column; align-items: center; }
  .st { display: none; }
}
@media (max-width: 640px) {
  .ti { width: 30px; height: 30px; border-radius: 8px; }
}
</style>
