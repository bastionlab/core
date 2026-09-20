<script setup lang="ts">
/** The things the household actually opens. Big, colour-coded tiles — the home page's centrepiece. */
defineProps<{ services: any[] }>()
</script>

<template>
  <div id="services" class="apps">
    <a
      v-for="s in services" :key="s.name" :href="s.url" target="_blank"
      class="app" :class="{ down: !s.up }" :style="{ '--h': s.hue ?? 220 }"
    >
      <span class="icon">{{ s.icon }}</span>
      <span class="name">{{ s.name }}</span>
      <span class="note muted small">{{ s.note }}</span>
      <span class="foot small">
        <span class="dot" :class="s.up ? 'ok' : 'bad'" />
        <span :class="s.up ? 'muted' : 'bad'">{{ s.up ? `${s.ms} ms` : 'down' }}</span>
        <span v-if="s.ct" class="faint ct">CT {{ s.ct }}</span>
      </span>
    </a>
  </div>
</template>

<style scoped>
.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
.app {
  position: relative; display: flex; flex-direction: column; gap: 3px; min-width: 0;
  padding: 16px; border-radius: 14px; color: var(--text); overflow: hidden;
  background: linear-gradient(160deg, color-mix(in srgb, hsl(var(--h) 70% 55%) 9%, var(--panel)), var(--panel) 60%);
  border: 1px solid var(--line);
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.app::after {
  content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
  background: linear-gradient(90deg, hsl(var(--h) 70% 55%), transparent);
  opacity: .8;
}
.app:hover {
  text-decoration: none; transform: translateY(-3px);
  border-color: color-mix(in srgb, hsl(var(--h) 70% 55%) 45%, var(--line));
  box-shadow: 0 10px 24px -14px hsl(var(--h) 70% 40% / .7);
}
.app.down { opacity: .72; }
.icon {
  font-size: 24px; width: 46px; height: 46px; display: grid; place-items: center; margin-bottom: 8px;
  border-radius: 12px; background: color-mix(in srgb, hsl(var(--h) 70% 55%) 16%, transparent);
}
.name { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foot { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
.foot .ct { margin-left: auto; }
</style>
