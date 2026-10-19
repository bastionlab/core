<script setup lang="ts">
useHead({ title: 'Habits · pve' })
// the tracker is its own offline-first app in CT 204 (MaxJC0/habits); the dash only frames it
const src = 'https://habits.example-tailnet.ts.net/'
</script>

<template>
  <iframe class="habits" :src="src" title="Habits" />
</template>

<style scoped>
.habits { display: block; width: 100%; max-width: 640px; margin: 0 auto; height: calc(100dvh - 48px); margin-bottom: -36px; border: 0; background: var(--bg); }
@media (max-width: 640px) { .habits { height: calc(100dvh - 24px - var(--tabbar, 0px)); margin-bottom: -16px; } }
</style>
