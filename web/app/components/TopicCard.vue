<script setup lang="ts">
/** one card in Home's "Sections" grid; add-ons render it from their Home<Id>.global.vue (addon.yaml `home: true`) */
defineProps<{ to: string, icon: string, name: string, sub?: string, chips?: { text: string, tone?: string }[] }>()
</script>

<template>
  <NuxtLink :to="to" class="topic">
    <span class="ti"><Icon :name="icon" :size="18" /></span>
    <span class="name">{{ name }}</span>
    <span class="chips">
      <span v-for="c in chips ?? []" :key="c.text" class="pill" :class="c.tone">{{ c.text }}</span>
      <span v-if="!chips?.length" class="sub">{{ sub }}</span>
    </span>
    <Icon name="arrow" :size="16" class="go" />
  </NuxtLink>
</template>

<style scoped>
.topic {
  display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 14px;
  border-radius: var(--radius); color: var(--text); background: var(--panel); border: 1px solid var(--line);
  transition: border-color .15s, background .15s;
}
.topic:hover { text-decoration: none; border-color: var(--line-2); background: var(--panel-2); }
.ti { width: 34px; height: 34px; border-radius: var(--radius-sm); display: grid; place-items: center; background: var(--panel-2); color: var(--muted); flex: none; }
.topic:hover .ti { color: var(--accent); }
.name { font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-left: auto; min-width: 0; }
.go { color: var(--faint); }
.sub { font-size: 12px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 640px) {
  .topic { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto auto; gap: 8px 10px; align-items: center; padding: 11px 12px; }
  .ti { width: 30px; height: 30px; border-radius: 8px; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { grid-column: 1 / -1; justify-content: flex-start; margin-left: 0; }
  .go { display: none; }
}
</style>
