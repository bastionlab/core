<script setup lang="ts">
/** The things the household actually opens — the home page's centrepiece. */
defineProps<{ services: any[] }>()
</script>

<template>
  <div id="services" class="apps">
    <AppTile v-for="s in services" :key="s.name" :s="s" />
  </div>
</template>

<style scoped>
.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
@media (max-width: 640px) { .apps { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } }
</style>
