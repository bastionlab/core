<script setup lang="ts">
// a skin (Designs add-on) may animate page changes: CSS classes .skin-<name>-enter-active / -leave-active / …
const skin = useSkin()
// stock look: a short fade-and-rise between pages; a skin brings its own transition classes
const pageTransition = computed(() => ({ name: skin.value ? `skin-${skin.value}` : 'page', mode: 'out-in' as const }))
</script>

<template>
  <NuxtLayout>
    <NuxtPage :transition="pageTransition" />
  </NuxtLayout>
</template>
