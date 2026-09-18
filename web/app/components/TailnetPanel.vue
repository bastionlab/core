<script setup lang="ts">
defineProps<{ t: any, now: number }>()
</script>

<template>
  <Panel id="tailnet" title="Tailnet" :sub="t.tailnet">
    <div class="nodes">
      <div v-for="n in t.nodes" :key="n.ip" class="node">
        <span class="dot" :class="n.online ? 'ok' : ''" />
        <div class="body">
          <div><b>{{ n.name }}</b> <span v-for="tag in n.tags" :key="tag" class="pill">{{ tag.replace('tag:', '') }}</span>
            <span v-if="n.routes.length" class="pill accent" :title="n.routes.join(', ')">subnet router</span></div>
          <div class="small faint mono">{{ n.ip }} · {{ n.os }}</div>
        </div>
        <span class="small muted">{{ n.online ? 'online' : ago(n.lastSeen, now) }}</span>
      </div>
    </div>
    <div v-if="t.authKey" class="small key" :class="t.authKey.expires - now < 14 * 86400 ? 'warn' : 'muted'">
      newdev auth key expires {{ ago(t.authKey.expires, now) }} ({{ new Date(t.authKey.expires * 1000).toLocaleDateString('de-DE') }})
    </div>
  </Panel>
</template>

<style scoped>
.nodes { display: flex; flex-direction: column; gap: 10px; }
.node { display: flex; align-items: center; gap: 10px; }
.body { min-width: 0; flex: 1; }
.body .pill { margin-left: 4px; }
.key { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--line); }
</style>
