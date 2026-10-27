<script setup lang="ts">
// a skin (Designs add-on) may animate page changes: CSS classes .skin-<name>-enter-active / -leave-active / …
const skin = useSkin()
const pageTransition = computed(() => (skin.value ? { name: `skin-${skin.value}`, mode: 'out-in' as const } : false))
</script>

<template>
  <NuxtLayout>
    <NuxtPage :transition="pageTransition" />
  </NuxtLayout>
</template>
