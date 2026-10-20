<script setup lang="ts">
const props = defineProps<{ note: any }>()
const emit = defineEmits<{ open: [], patch: [Record<string, any>], tag: [string] }>()
const n = computed(() => props.note)
const tasks = computed(() => taskCount(n.value.body))
const html = computed(() => noteHtml(n.value.body))

function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (t instanceof HTMLInputElement && t.dataset.task != null) {
    e.stopPropagation()
    emit('patch', { body: toggleTask(n.value.body, Number(t.dataset.task)) })
    return
  }
  if (t.closest('a')) return // links in a note open, they do not open the note
  emit('open')
}
</script>

<template>
  <article class="card" :class="[n.state, { pinned: n.pinned }]" tabindex="0" @click="onClick" @keydown.enter.self="emit('open')">
    <img v-if="n.images.length" class="cover" :src="noteImg(n.images[0])" alt="" loading="lazy">
    <div class="in">
      <div class="head">
        <span class="kind" :title="n.kind">{{ kindIcon(n.kind) }}</span>
        <h3>{{ n.title || (n.job ? 'New note' : 'Untitled') }}</h3>
        <span class="tools" @click.stop>
          <button type="button" class="b" :class="{ on: n.pinned }" :title="n.pinned ? 'unpin' : 'pin to the top'" @click="emit('patch', { pinned: !n.pinned })"><Icon name="pin" :size="14" /></button>
          <button type="button" class="b" :title="n.state === 'done' ? 'reopen' : 'mark done'" @click="emit('patch', { state: n.state === 'done' ? 'active' : 'done' })">✓</button>
        </span>
      </div>
      <div class="body md" v-html="html" />
      <div class="foot small">
        <span v-if="n.job" class="pill accent working">✨ {{ n.job === 'expand' ? 'planning' : 'tidying' }}…</span>
        <span v-else-if="n.aiError" class="pill bad" :title="n.aiError">AI failed</span>
        <span v-if="tasks.total" class="pill" :class="{ ok: tasks.done === tasks.total }">{{ tasks.done }}/{{ tasks.total }}</span>
        <span v-if="n.images.length > 1" class="faint">🖼️ {{ n.images.length }}</span>
        <button v-if="n.topic" type="button" class="tag" @click.stop="emit('tag', n.topic)">{{ n.topic }}</button>
        <span class="faint when" :title="new Date(n.updated * 1000).toLocaleString()">{{ ago(n.created) }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card { break-inside: avoid; margin-bottom: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; cursor: pointer; transition: border-color .15s; }
.card:hover, .card:focus-visible { border-color: var(--line-2); outline: none; }
.card.pinned { border-color: rgba(142, 166, 255, .35); }
.card.done { opacity: .6; }
.card.done h3 { text-decoration: line-through; text-decoration-color: var(--faint); }
.cover { display: block; width: 100%; max-height: 200px; object-fit: cover; border-bottom: 1px solid var(--line); }
.in { padding: 12px 14px 10px; }
.head { display: flex; align-items: flex-start; gap: 8px; }
.kind { font-size: 14px; line-height: 20px; }
h3 { flex: 1; margin: 0; font-size: 14.5px; font-weight: 600; line-height: 20px; min-width: 0; overflow-wrap: anywhere; }
.tools { display: flex; gap: 2px; opacity: 0; transition: opacity .15s; margin: -3px -6px 0 0; }
.card:hover .tools, .card:focus-within .tools { opacity: 1; }
/* no hover on touch: keep pin + done visible, with room for a thumb */
@media (pointer: coarse) {
  .tools { opacity: 1; margin: -7px -8px 0 0; }
  .b { width: 34px; height: 34px; }
  .body :deep(li > input[type='checkbox']) { width: 18px; height: 18px; vertical-align: -3px; }
  .body :deep(li:has(> input[type='checkbox'])) { padding-left: 28px; text-indent: -28px; }
}
.b { width: 26px; height: 26px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--faint); cursor: pointer; font-size: 13px; }
.b:hover { background: var(--panel-2); color: var(--text); }
.b.on { color: var(--accent); }
.body { margin-top: 6px; color: var(--muted); font-size: 13px; max-height: 210px; overflow: hidden; -webkit-mask-image: linear-gradient(#000 160px, transparent 210px); mask-image: linear-gradient(#000 160px, transparent 210px); }
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 8px; }
.tag { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; cursor: pointer; opacity: .8; }
.tag:hover { opacity: 1; text-decoration: underline; }
.when { margin-left: auto; }
.working { animation: glow 1.2s infinite alternate; }
@keyframes glow { to { opacity: .55; } }
</style>
