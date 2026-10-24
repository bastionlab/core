<script setup lang="ts">
/** Dev's card on the home page */
const { data: boxes, refresh } = useProjects()
onMounted(() => { if (!boxes.value) refresh() })
const projects = computed(() => (boxes.value ?? []).flatMap(b => b.projects ?? []))
const previews = computed(() => projects.value.filter((p: any) => p.running).length)
const claudes = computed(() => projects.value.filter((p: any) => p.cc?.running).length)
const chips = computed(() => boxes.value
  ? [
      { text: `${projects.value.length} projects` },
      ...(previews.value ? [{ text: `${previews.value} running`, tone: 'ok' }] : []),
      ...(claudes.value ? [{ text: `${claudes.value} Claude`, tone: 'accent' }] : []),
    ]
  : [])
</script>

<template>
  <TopicCard to="/dev" icon="dev" name="Dev" sub="Projects & terminals" :chips="chips" />
</template>
