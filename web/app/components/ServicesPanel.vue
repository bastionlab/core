<script setup lang="ts">
/** admin UIs: a tile grid, or plain rows (`list`) when it sits inside a Panel */
defineProps<{ services: any[], list?: boolean }>()
</script>

<template>
  <div id="services" class="services" :class="{ list }">
    <a
      v-for="s in services" :key="s.name" :href="s.url" target="_blank" class="svc"
      :title="`${s.note ?? ''}${s.ct ? ` · CT ${s.ct}` : ''}${s.up ? ` · ${s.ms} ms` : ' · down'}`"
    >
      <span class="icon"><AppLogo :name="s.name" /></span>
      <span class="body">
        <span class="name">{{ s.name }}</span>
        <span class="note">{{ s.up ? s.note : 'down' }}</span>
      </span>
      <span class="dot" :class="s.up ? 'ok' : 'bad'" />
    </a>
  </div>
</template>

<style scoped>
.services { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin-bottom: 14px; scroll-margin-top: 16px; }
.svc { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 11px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); color: var(--text); transition: border-color .15s, background .15s; }
.svc:hover { text-decoration: none; border-color: var(--line-2); background: var(--panel-2); }
.icon { font-size: 18px; width: 36px; height: 36px; display: grid; place-items: center; background: var(--panel-2); border-radius: var(--radius-sm); flex: none; }
.body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.body > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name { font-weight: 600; }
.note { font-size: 12px; color: var(--faint); }
.svc .dot { width: 7px; height: 7px; box-shadow: none; }

.services.list { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; margin: 0; }
.list .svc { padding: 7px 8px; border: 0; background: none; border-radius: var(--radius-sm); }
.list .svc:hover { background: var(--panel-2); }
.icon :deep(img) { width: 62%; height: 62%; }
.list .icon { width: 32px; height: 32px; font-size: 16px; }
@media (max-width: 640px) { .services { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .svc { padding: 10px; gap: 10px; } }
@media (max-width: 640px) { .services.list { grid-template-columns: minmax(0, 1fr); } }
</style>
