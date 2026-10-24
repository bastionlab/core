<script setup lang="ts">
/** Notes' card on the home page */
const { data: notes, refresh } = useNotes()
onMounted(refresh) // changes in the background: fresh on every visit
const active = computed(() => (notes.value?.notes ?? []).filter((n: any) => n.state === 'active'))
const open = computed(() => active.value.reduce((s: number, n: any) => { const t = taskCount(n.body); return s + t.total - t.done }, 0))
const todos = computed(() => active.value.filter((n: any) => n.kind === 'todo').length)
const chips = computed(() => notes.value
  ? [
      { text: `${active.value.length} notes` },
      ...(todos.value ? [{ text: `${todos.value} todos`, tone: 'accent' }] : []),
      ...(open.value ? [{ text: `${open.value} open`, tone: 'warn' }] : []),
    ]
  : [])
</script>

<template>
  <TopicCard to="/notes" icon="note" name="Notes" sub="Quick capture" :chips="chips" />
</template>
