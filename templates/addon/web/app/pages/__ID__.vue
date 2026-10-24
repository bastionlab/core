<script setup lang="ts">
useHead({ title: '__NAME__ · pve' })
const { data, error } = useFetch<any>('/api/__ID__', { server: false })
</script>

<template>
  <div>
    <h2 class="sec">__NAME__</h2>
    <div v-if="error" class="errbox">{{ error.statusMessage || error.message }}</div>
    <Panel v-else title="Hello">
      <p class="muted small">{{ data?.hello ?? 'Loading…' }}</p>
    </Panel>
  </div>
</template>
