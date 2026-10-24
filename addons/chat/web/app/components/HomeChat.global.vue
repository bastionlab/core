<script setup lang="ts">
/** Chat's card on the home page: how much of Claude's 5-hour window is used */
const { usage, load } = useClaudeUsage()
onMounted(() => { if (!usage.value) load() })
const used = computed(() => usage.value?.windows?.five_hour?.used)
const chips = computed(() => used.value != null ? [{ text: `Claude ${Math.round(used.value * 100)}%`, tone: used.value > 0.8 ? 'warn' : '' }] : [])
</script>

<template>
  <TopicCard to="/chat" icon="chat" name="Chat" sub="Local model & Claude" :chips="chips" />
</template>
