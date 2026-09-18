<script setup lang="ts">
defineProps<{ services: any[] }>()
</script>

<template>
  <div id="services" class="services">
    <a v-for="s in services" :key="s.name" :href="s.url" target="_blank" class="svc">
      <span class="icon">{{ s.icon }}</span>
      <span class="body">
        <span class="name">{{ s.name }}</span>
        <span class="muted small">{{ s.note }}<template v-if="s.ct"> · CT {{ s.ct }}</template></span>
      </span>
      <span class="state">
        <span class="dot" :class="s.up ? 'ok' : 'bad'" />
        <span class="small muted">{{ s.up ? `${s.ms} ms` : 'down' }}</span>
      </span>
    </a>
  </div>
</template>

<style scoped>
.services { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-bottom: 16px; scroll-margin-top: 16px; }
.svc { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); color: var(--text); transition: border-color .15s, transform .15s; }
.svc:hover { text-decoration: none; border-color: var(--accent); transform: translateY(-1px); }
.icon { font-size: 22px; width: 36px; height: 36px; display: grid; place-items: center; background: var(--panel-2); border-radius: 8px; flex: none; }
.body { display: flex; flex-direction: column; min-width: 0; }
.body > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name { font-weight: 600; }
.state { margin-left: auto; white-space: nowrap; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
</style>
