<script setup lang="ts">
/** every panel folds from its header; fold="closed" starts folded, fold="phone" starts folded only on a phone. The viewer's choice sticks per panel (localStorage). */
const props = withDefaults(defineProps<{ title: string, sub?: string, id?: string, fold?: 'open' | 'closed' | 'phone' }>(), { fold: 'open' })
const key = `panel:${props.id ?? props.title}`
const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
const open = ref(props.fold === 'open' || (props.fold === 'phone' && !phone))
if (props.fold) try { const v = localStorage.getItem(key); if (v) open.value = v === '1' } catch {}
function toggle() {
  if (!props.fold) return
  open.value = !open.value
  try { localStorage.setItem(key, open.value ? '1' : '0') } catch {}
}
</script>

<template>
  <section :id="id" class="panel" :class="{ folded: !open }">
    <header :class="{ toggle: fold }" @click="toggle">
      <Icon v-if="fold" name="arrow" :size="15" class="chev" />
      <h2>{{ title }}</h2>
      <span v-if="sub" class="sub">{{ sub }}</span>
      <div v-if="open" class="actions" @click.stop><slot name="actions" /></div>
    </header>
    <slot v-if="open" />
  </section>
</template>

<style scoped>
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px 18px; min-width: 0; scroll-margin-top: 16px; }
.panel.folded { padding-bottom: 16px; align-self: start; }
header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; min-height: 26px; flex-wrap: wrap; }
.folded header { margin-bottom: 0; }
header.toggle { cursor: pointer; user-select: none; margin-left: -4px; }
header.toggle:hover h2 { color: var(--accent); }
.chev { color: var(--faint); transform: rotate(90deg); transition: transform .15s; }
.folded .chev { transform: none; }
h2 { font-size: 14px; font-weight: 600; margin: 0; color: var(--text); }
.sub { font-size: 12px; color: var(--faint); min-width: 0; }
.actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; cursor: default; }
@media (max-width: 640px) { .panel { padding: 14px 14px 16px; } .panel.folded { padding-bottom: 14px; } }
</style>
