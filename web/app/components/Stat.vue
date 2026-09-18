<script setup lang="ts">
defineProps<{ label: string, value: string | number, tone?: string }>()
</script>

<template>
  <div class="stat"><span class="muted small">{{ label }}</span><b :class="tone">{{ value }}</b></div>
</template>

<style scoped>
.stat { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
b { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
