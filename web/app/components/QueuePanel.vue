<script setup lang="ts">
const props = defineProps<{ title: string, sub?: string, items: any[], empty?: string, id?: string }>()
const list = computed(() => props.items ?? [])
const active = computed(() => list.value.filter(i => (i.speed ?? 0) > 0))
const eta = (s?: string | null) => (!s ? null : s.replace(/^00:/, '').replace(/\.\d+$/, ''))
</script>

<template>
  <Panel :id="id" :title="title" :sub="sub ?? `${list.length} in queue${active.length ? ` · ${active.length} downloading` : ''}`">
    <div v-if="!list.length" class="faint small">{{ empty ?? 'Nothing downloading' }}</div>
    <div v-for="(i, n) in list" :key="i.id ?? n" class="item" :class="{ err: i.error || i.status === 'failed' }">
      <div v-if="i.error && !i.title" class="small bad">{{ i.error }}</div>
      <template v-else>
        <div class="head">
          <b class="title">{{ i.title ?? i.release }}</b>
          <span class="pill" :class="i.error ? 'bad' : i.state === 'importPending' ? 'warn' : i.speed ? 'accent' : ''">
            {{ i.state ?? i.status ?? '–' }}
          </span>
        </div>
        <div v-if="i.sub" class="small muted sub">{{ i.sub }}</div>
        <div class="track"><i :style="{ width: Math.max(1, i.progress || 0) + '%' }" /></div>
        <div class="small muted meta">
          <span>{{ i.progress }}% of {{ bytes(i.size) }}</span>
          <span v-if="i.speed">{{ bytes(i.speed) }}/s</span>
          <span v-if="eta(i.eta)">eta {{ eta(i.eta) }}</span>
          <span v-if="i.seeds != null">{{ i.seeds }} seeds</span>
          <span v-if="i.ratio != null">ratio {{ i.ratio }}</span>
        </div>
        <div v-if="i.error" class="small bad">{{ i.error }}</div>
        <div v-for="(m, k) in i.messages ?? []" :key="k" class="small warn">{{ m }}</div>
      </template>
    </div>
  </Panel>
</template>

<style scoped>
.item { padding: 10px 0; }
.item + .item { border-top: 1px solid var(--line); }
.head { display: flex; align-items: center; gap: 8px; }
.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { margin-top: 1px; }
.track { height: 5px; background: var(--track); border-radius: 3px; overflow: hidden; margin: 7px 0 5px; }
.track i { display: block; height: 100%; background: var(--accent); transition: width .6s ease; }
.item.err .track i { background: var(--bad); }
.meta { display: flex; flex-wrap: wrap; gap: 4px 14px; }
</style>
