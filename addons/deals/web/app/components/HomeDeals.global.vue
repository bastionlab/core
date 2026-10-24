<script setup lang="ts">
/** Deals' card on the home page */
const { data: d, refresh } = useDeals()
onMounted(refresh) // changes in the background: fresh on every visit
const fresh = computed(() => (d.value?.feed ?? []).filter((i: any) => Date.now() / 1000 - (i.posted_at ?? i.first_seen_at ?? 0) < 86400).length)
const chips = computed(() => d.value
  ? [
      { text: `${d.value.status?.enabled ?? 0} searches` },
      ...(fresh.value ? [{ text: `${fresh.value} new`, tone: 'accent' }] : []),
    ]
  : [])
</script>

<template>
  <TopicCard to="/deals" icon="deals" name="Deals" sub="Kleinanzeigen hunter" :chips="chips" />
</template>
