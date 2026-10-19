<script setup lang="ts">
defineProps<{ label: string, value: string | number, tone?: string }>()
</script>

<template>
  <div class="stat"><span class="lbl">{{ label }}</span><b :class="tone">{{ value }}</b></div>
</template>

<style scoped>
.stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lbl { font-size: 12px; color: var(--faint); }
b { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
