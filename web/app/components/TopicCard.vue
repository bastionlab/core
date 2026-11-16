<script setup lang="ts">
/**
 * one card in Home's "Sections" grid; add-ons render it from their Home<Id>.global.vue (addon.yaml `home: true`).
 * It fills the tile the Home layout gives it and arranges what it has by the tile's own size (container queries on
 * HomeItem's `tile`): 1×1 = icon + name, narrow and tall = the headline figure, short = one line (+ the figure),
 * wide = chips beside the name, tall = figure, chips, bars, then the `more` rows (whole rows only), tall and wide =
 * figure/chips/bars on the left and the rows on the right.
 */
type Chip = { text: string, tone?: string }
type Stat = { value: string, label?: string, tone?: string }
const props = defineProps<{
  to: string, icon: string, name: string, sub?: string, chips?: Chip[]
  /** the headline figure; without one, the first chip that starts with a number becomes it */
  stat?: Stat
  /** small meters (value 0-100) */
  bars?: { label: string, value: number, text?: string, tone?: string }[]
  /** detail rows (newest notes, latest deals, …) for tall tiles */
  more?: { text: string, sub?: string, tone?: string }[]
}>()
const skinned = useSkinned('TopicCard')

const derived = computed(() => {
  if (props.stat || props.bars?.length) return null
  const list = props.chips ?? []
  for (let i = 0; i < list.length; i++) {
    const m = /^([\d.,]+\s?[%€$kKMG]*|\d+\/\d+)\s+(.+)$/.exec(list[i]!.text)
    if (m) return { i, stat: { value: m[1]!.trim(), label: m[2]!, tone: list[i]!.tone } as Stat }
  }
  return null
})
const theStat = computed<Stat | undefined>(() => props.stat ?? derived.value?.stat)
const shown = computed(() => (props.chips ?? []).filter((_, i) => i !== derived.value?.i))
const line = computed(() => shown.value[0]?.text ?? props.sub)
const lineTone = computed(() => shown.value[0]?.tone)
const fill = (v: number) => Math.max(0, Math.min(100, Number(v) || 0)) / 100
</script>

<template>
  <component :is="skinned" v-if="skinned" v-bind="$props" />
  <NuxtLink v-else :to="to" class="topic press" :class="{ hasmore: !!more?.length, nomore: !more?.length, nostat: !theStat, nobars: !bars?.length, nolabel: !theStat?.label }">
    <span class="hd">
      <span class="ti"><Icon :name="icon" :size="18" /></span>
      <span class="txt">
        <span class="name">{{ name }}</span>
        <span v-if="line" class="l1" :class="lineTone">{{ line }}</span>
        <span v-if="sub" class="l2">{{ sub }}</span>
      </span>
      <span v-if="theStat" class="hstat num" :class="theStat.tone">{{ theStat.value }}</span>
      <span v-if="shown.length" class="hch">
        <span v-for="c in shown" :key="c.text" class="pill" :class="c.tone">{{ c.text }}</span>
      </span>
      <Icon name="arrow" :size="16" class="go" />
    </span>
    <span class="body">
      <span class="main">
        <span v-if="theStat" class="stat">
          <span class="sv num" :class="theStat.tone">{{ theStat.value }}</span>
          <span v-if="theStat.label" class="sl">{{ theStat.label }}</span>
        </span>
        <span v-if="shown.length" class="chips">
          <span v-for="c in shown" :key="c.text" class="pill" :class="c.tone">{{ c.text }}</span>
        </span>
        <span v-if="bars?.length" class="bars">
          <span v-for="b in bars" :key="b.label" class="bar">
            <span class="bl"><span class="bn">{{ b.label }}</span><span v-if="b.text" class="bt num">{{ b.text }}</span></span>
            <span class="trk"><span class="fill" :class="b.tone" :style="{ transform: `scaleX(${fill(b.value)})` }" /></span>
          </span>
        </span>
        <span v-if="sub" class="sub">{{ sub }}</span>
      </span>
      <span v-if="more?.length" class="more">
        <span v-for="(r, i) in more" :key="i" class="row">
          <span class="rt" :class="r.tone">{{ r.text }}</span>
          <span v-if="r.sub" class="rs">{{ r.sub }}</span>
        </span>
      </span>
    </span>
    <span v-if="chips?.some(c => c.tone)" class="dot st" :class="chips.find(c => c.tone === 'bad' || c.tone === 'warn')?.tone ?? 'ok'" />
  </NuxtLink>
</template>

<style scoped>
.topic {
  --rh: 24px; --rf: 13px;
  position: relative; display: flex; flex-direction: column; gap: 8px; min-width: 0; height: 100%;
  padding: 12px 14px; overflow: hidden;
  border-radius: var(--radius); color: var(--text); background: var(--panel); border: 1px solid var(--line);
  transition: border-color var(--dur) var(--ease-out), background var(--dur) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.topic:hover { text-decoration: none; border-color: var(--line-2); background: var(--panel-2); }
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.bad { color: var(--bad); }
.accent { color: var(--accent); }
.pill.ok, .pill.warn, .pill.bad, .pill.accent { color: inherit; }

.hd { display: flex; align-items: center; gap: 12px; min-width: 0; flex: none; }
.ti { width: 34px; height: 34px; border-radius: var(--radius-sm); display: grid; place-items: center; background: var(--panel-2); color: var(--muted); flex: none; }
.topic:hover .ti { color: var(--accent); }
.txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.l1, .l2 { display: none; font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.l1.warn { color: var(--warn); }
.l1.bad { color: var(--bad); }
.hstat { display: none; flex: none; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.hch { display: none; flex-wrap: nowrap; gap: 4px; min-width: 0; justify-content: flex-end; overflow: hidden; max-width: 65%; }
.go { color: var(--faint); flex: none; }
.st { display: none; position: absolute; top: 8px; right: 8px; width: 7px; height: 7px; box-shadow: none; }

/* body: the figure block (main) and the detail rows */
.body { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
.main { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; flex: 0 1 auto; overflow: hidden; }
.stat { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: none; }
.sv { flex: none; max-width: 100%; font-size: 24px; line-height: 1.15; font-weight: 600; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sv.ok { color: var(--text); }
.sl { min-width: 0; font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* one line of whole pills: the ones that do not fit wrap to a hidden second line */
.chips { display: flex; flex-flow: row wrap; align-content: flex-start; gap: 4px; min-width: 0; height: 22px; flex: none; overflow: hidden; }
.chips .pill { flex: none; }
/* bars: fixed height, wrapped into hidden extra columns, so only whole bars show */
.bars { flex: 0 1 auto; min-height: 0; display: flex; flex-flow: column wrap; align-content: flex-start; min-width: 0; overflow: hidden; }
.bar { flex: none; width: 100%; height: 30px; display: flex; flex-direction: column; justify-content: flex-start; gap: 3px; min-width: 0; font-size: 12px; }
.bl { display: flex; gap: 8px; justify-content: space-between; min-width: 0; color: var(--muted); }
.bn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bt { flex: none; color: var(--faint); font-variant-numeric: tabular-nums; }
.trk { display: block; height: 4px; border-radius: 999px; background: var(--track); overflow: hidden; }
.fill { display: block; height: 100%; width: 100%; border-radius: 999px; background: var(--accent); transform-origin: left center; transition: transform var(--dur) var(--ease-out); }
.fill.ok { background: var(--ok); }
.fill.warn { background: var(--warn); }
.fill.bad { background: var(--bad); }
.hasmore .sub, .topic:not(.nolabel) .sub { display: none; }
.sub { font-size: 12px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* rows: fixed height, wrapped into hidden extra columns, so only whole rows show */
.more {
  flex: 1 1 0; min-height: 0; min-width: 0; display: flex; flex-flow: column wrap; align-content: flex-start; overflow: hidden;
}
.row { flex: none; width: 100%; height: var(--rh); border-top: 1px solid var(--line); display: flex; gap: 10px; align-items: center; min-width: 0; font-size: var(--rf); }
.rt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs { margin-left: auto; flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(var(--rf) - 1px); color: var(--faint); }

/* short: header only. The default tile (tall, narrower than 300px) is the base above. */
@container tile (max-height: 99px) {
  .topic { padding: 8px 12px; justify-content: center; }
  .body, .go { display: none; }
}
/* short and not wide: the first chip / sub line goes under the name, the figure replaces the arrow */
@container tile (max-height: 99px) and (max-width: 299px) {
  .hd { gap: 10px; }
  .l1 { display: block; }
  .hstat { display: block; }
  .nostat .hstat { display: none; }
}
/* short and wide: name + sub, the figure and every chip on the right */
@container tile (max-height: 99px) and (min-width: 300px) {
  .l2 { display: block; }
  .hstat { display: block; }
  .hch { display: flex; }
  .topic:not(.nostat) .hch { max-width: 55%; }
  .hd:has(.hch, .hstat) .go { display: none; }
  .hd:not(:has(.hch, .hstat)) .go { display: block; }
}
/* tall and wide: figure, chips, bars, sub on the left; the rows on the right */
@container tile (min-height: 100px) and (min-width: 300px) {
  .body { display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 6fr); grid-template-rows: minmax(0, 1fr); gap: 0; }
  .nomore .body { grid-template-columns: minmax(0, 1fr); }
  .main { padding-right: 12px; }
  .nomore .main { padding-right: 0; }
  .more { border-left: 1px solid var(--line); padding: 0 0 0 12px; }
  .row { border-top: 0; }
  .main { flex: 1 1 auto; }
}
/* tall but not tall enough for a figure and its chips: the figure only */
@container tile (min-height: 100px) and (max-height: 199px) {
  .topic:not(.nostat) .chips { display: none; }
}
@container tile (max-height: 99px) and (max-width: 299px) {
  .nostat .go { display: block; }
}
/* big */
@container tile (min-height: 220px) and (min-width: 260px) {
  .topic { --rh: 28px; --rf: 14px; }
  .ti { width: 40px; height: 40px; }
  .name { font-size: 16px; }
  .sv { font-size: 34px; }
  .sl, .bar, .sub { font-size: 13px; }
}
/* one column: icon over name, the status as a dot; tall enough, the figure under it */
@container tile (max-width: 129px) {
  .topic { align-items: center; justify-content: center; gap: 6px; padding: 8px 6px; text-align: center; }
  .hd { flex-direction: column; gap: 6px; max-width: 100%; }
  .txt { align-items: center; max-width: 100%; flex: none; }
  .name { font-size: 12px; max-width: 100%; }
  .topic .l1, .topic .l2, .topic .hstat, .topic .hch, .topic .go, .topic .body { display: none; }
  .st { display: block; }
}
@container tile (max-width: 129px) and (min-height: 140px) {
  .topic:not(.nostat) .body { display: flex; flex: none; align-items: center; max-width: 100%; }
  .topic:not(.nostat) .main { align-items: center; }
  .topic:not(.nostat) .st { display: none; }
  .chips, .bars, .sub, .more { display: none; }
  .sv { font-size: 21px; }
  .stat { align-items: center; }
}
@media (max-width: 640px) {
  .ti { width: 30px; height: 30px; border-radius: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .topic, .fill { transition: none; }
}
</style>
