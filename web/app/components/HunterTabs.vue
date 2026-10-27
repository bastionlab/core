<script setup lang="ts">
/** The hunter pages' (deals, wohnungen, jobs) page tabs: one per view ("Matches 12 · Saved 3 · Rejected 40") plus
 *  "Searches", whose content is the #setup slot (search list, profile, CV). One chip per search on every tab (the
 *  Searches tab's profile/CV follow it); under a view the default slot goes at the end of that chip row (deals puts its shipping switch there). */
const props = defineProps<{ views: readonly { v: string, label: string, n?: number }[], tabs: { id: number | null, name: string, hits: number, enabled: boolean }[], setupBadge?: number }>()
const show = defineModel<string>('show', { required: true })
const selected = defineModel<number | null>('selected', { required: true })
const slots = useSlots()
const { t } = useI18n()
const ptabs = computed(() => [
  ...props.views.map(v => ({ key: v.v, label: `${v.label} ${v.n ?? 0}` })),
  { key: 'searches', label: t('tabs.searches'), icon: 'settings', badge: props.setupBadge || undefined },
])
</script>

<template>
  <PageTabs v-model="show" :tabs="ptabs" />
  <slot v-if="show !== 'searches'" name="note" />
  <div v-if="tabs.length > 2 || (slots.default && show !== 'searches')" class="tabs">
    <template v-if="tabs.length > 2">
      <button
        v-for="tb in tabs" :key="tb.id ?? 'all'" class="chip"
        :class="{ on: selected === tb.id, off: !tb.enabled }"
        @click="selected = tb.id"
      >{{ tb.name }} <span class="n">{{ tb.hits }}</span></button>
    </template>
    <slot v-if="show !== 'searches'" />
  </div>
  <slot v-if="show === 'searches'" name="setup" />
</template>

<style scoped>
.n { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; align-items: center; }
.chip.off { opacity: .55; }
</style>
