<script setup lang="ts">
/** The things the household actually opens — the home page's centrepiece. */
defineProps<{ services: any[] }>()
</script>

<template>
  <div id="services" class="apps">
    <a
      v-for="s in services" :key="s.name" :href="s.url" target="_blank"
      class="app" :class="{ down: !s.up }" :style="{ '--h': s.hue ?? 220 }"
      :title="s.up ? `${s.ms} ms${s.ct ? ` · CT ${s.ct}` : ''}` : `down${s.error ? `: ${s.error}` : ''}`"
    >
      <span class="icon">{{ s.icon }}</span>
      <span class="body">
        <span class="name">{{ s.name }}</span>
        <span class="note">{{ s.up ? s.note : 'down' }}</span>
      </span>
      <span class="dot" :class="s.up ? 'ok' : 'bad'" />
    </a>
  </div>
</template>

<style scoped>
.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
.app {
  display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 14px;
  border-radius: var(--radius); color: var(--text); background: var(--panel); border: 1px solid var(--line);
  transition: border-color .15s, background .15s, transform .15s;
}
.app:hover {
  text-decoration: none; transform: translateY(-1px);
  border-color: hsl(var(--h) 60% 60% / .45);
  background: linear-gradient(135deg, hsl(var(--h) 70% 60% / .08), var(--panel) 70%);
}
.app.down { opacity: .7; }
.icon {
  font-size: 21px; width: 42px; height: 42px; display: grid; place-items: center; flex: none;
  border-radius: 11px; background: hsl(var(--h) 70% 60% / .14);
}
.body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app.down .note { color: var(--bad); }
.app .dot { width: 7px; height: 7px; box-shadow: none; }
.app { position: relative; }
@media (max-width: 640px) {
  .apps { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .app { gap: 10px; padding: 10px; }
  .icon { width: 34px; height: 34px; font-size: 17px; border-radius: 9px; }
  .app .dot { position: absolute; top: 8px; right: 8px; }
}
</style>
