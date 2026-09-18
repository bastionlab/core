<script setup lang="ts">
defineProps<{ title: string, sub?: string, id?: string }>()
</script>

<template>
  <section :id="id" class="panel">
    <header>
      <h2>{{ title }}</h2>
      <span v-if="sub" class="muted small">{{ sub }}</span>
      <div class="actions"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px 16px; min-width: 0; scroll-margin-top: 16px; }
header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
h2 { font-size: 13px; font-weight: 600; margin: 0; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
.actions { margin-left: auto; display: flex; gap: 6px; }
</style>
