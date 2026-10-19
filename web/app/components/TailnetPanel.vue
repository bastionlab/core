<script setup lang="ts">
const props = defineProps<{ t: any, now: number }>()
const online = computed(() => props.t.nodes.filter((n: any) => n.online).length)
</script>

<template>
  <Panel id="tailnet" title="Tailnet" fold="closed" :sub="`${online}/${t.nodes.length} online`">
    <div class="nodes">
      <div v-for="n in t.nodes" :key="n.ip" class="node" :title="`${n.ip} · ${n.os}`">
        <span class="dot" :class="n.online ? 'ok' : ''" />
        <b class="nm">{{ n.name }}</b>
        <span v-if="n.routes.length" class="pill accent" :title="n.routes.join(', ')">router</span>
        <span class="faint small mono ip">{{ n.ip }}</span>
        <span class="small st" :class="n.online ? 'muted' : 'faint'">{{ n.online ? n.os : ago(n.lastSeen, now) }}</span>
      </div>
    </div>
    <div v-if="t.authKey" class="small key" :class="t.authKey.expires - now < 14 * 86400 ? 'warn' : 'faint'">
      newdev key expires {{ ago(t.authKey.expires, now) }}
    </div>
  </Panel>
</template>

<style scoped>
.nodes { display: flex; flex-direction: column; }
.node { display: flex; align-items: center; gap: 10px; padding: 6px 0; min-width: 0; }
.node + .node { border-top: 1px solid var(--line); }
.node .dot { width: 7px; height: 7px; box-shadow: none; }
.nm { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ip { margin-left: auto; }
.st { width: 90px; text-align: right; white-space: nowrap; }
.key { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
@media (max-width: 640px) { .ip { display: none; } .st { margin-left: auto; } }
</style>
