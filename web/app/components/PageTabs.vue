<script setup lang="ts">
/**
 * A page's own sections, as one row of tabs at the top of the page (never a second sidebar): sticks under the top
 * while scrolling, scrolls sideways on a phone with the open tab kept in view, a badge per tab for "needs you".
 * Pair with usePageTab() so the open tab lives in the URL. A skin may bring Skin<Name>PageTabs (same props/model).
 */
export interface PageTab { key: string, label: string, icon?: string, badge?: number | string, tone?: 'ok' | 'warn' | 'bad' }
const props = defineProps<{ tabs: PageTab[] }>()
const model = defineModel<string>({ required: true })
const skinned = useSkinned('PageTabs')
const { anchor, strip, nav, edge, measure, pick } = usePageTabs({ count: () => props.tabs.length, model, autoCompact: true })
</script>

<template>
  <component :is="skinned" v-if="skinned" v-model="model" :tabs="tabs" />
  <div v-else class="ptabs-wrap">
  <div ref="anchor" />
  <nav ref="nav" class="ptabs" :class="{ l: edge.l, r: edge.r }">
    <div ref="strip" class="strip" role="tablist" @scroll.passive="measure">
      <button
        v-for="t in tabs" :key="t.key" type="button" role="tab" class="pt" :class="{ on: model === t.key, ico: !!t.icon }"
        :aria-selected="model === t.key" :aria-label="t.label" :title="t.label" @click="pick(t.key)"
      >
        <Icon v-if="t.icon" :name="t.icon" :size="15" />
        <span class="lbl">{{ t.label }}</span>
        <span v-if="t.badge" class="bdg" :class="t.tone ?? 'warn'">{{ t.badge }}</span>
      </button>
    </div>
  </nav>
  </div>
</template>

<style scoped>
.ptabs-wrap { display: contents; }
.ptabs {
  position: sticky; top: var(--ptabs-top, env(safe-area-inset-top, 0px)); z-index: 20; margin: 0 0 14px;
  background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.strip { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; padding: 6px 0; overscroll-behavior-x: contain; }
.strip::-webkit-scrollbar { display: none; }
/* a soft fade on the side that has more tabs, so a phone shows there is more to swipe to */
.ptabs.l .strip { mask-image: linear-gradient(to right, transparent, black 28px); }
.ptabs.r .strip { mask-image: linear-gradient(to left, transparent, black 28px); }
.ptabs.l.r .strip { mask-image: linear-gradient(to right, transparent, black 28px, black calc(100% - 28px), transparent); }
.pt {
  flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border: 0; border-radius: var(--radius-sm);
  background: none; color: var(--muted); font: inherit; font-size: 13.5px; white-space: nowrap; cursor: pointer;
  transition: background-color var(--dur-fast), color var(--dur-fast), transform var(--dur-fast) var(--ease-spring);
}
@media (hover: hover) { .pt:hover { color: var(--text); background: var(--panel-2); } }
.pt:active { transform: scale(.97); transition-duration: 60ms; }
.pt.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.bdg { border-radius: 999px; font-size: 11px; font-weight: 600; padding: 0 6px; line-height: 17px; background: var(--warn-soft); color: var(--warn); }
.bdg.bad { background: var(--bad-soft); color: var(--bad); }
.bdg.ok { background: var(--ok-soft); color: var(--ok); }
@media (max-width: 640px) {
  .ptabs { margin-left: -12px; margin-right: -12px; padding: 0 8px; }
  .pt { padding: 8px 12px; min-height: 36px; }
  /* is-compact (set by usePageTabs only when the row overflows): a tab with an icon shows only the icon until it is the open one */
  .ptabs.is-compact .pt.ico:not(.on) .lbl { display: none; }
  .ptabs.is-compact .pt.ico:not(.on) { min-width: 40px; justify-content: center; }
}
</style>
