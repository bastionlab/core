<script setup lang="ts">
/** one app on Home (Immich, Jellyfin, …); <AppTiles> lays them out */
defineProps<{ s: any, inert?: boolean }>()
// on Home it fills its tile and shows what fits (container queries on HomeItem's `tile`): narrow = icon over
// name, tall = a bigger icon plus latency, container and address
const host = (u: string) => { try { return new URL(u).host } catch { return '' } }
</script>

<template>
  <a
    :href="inert ? undefined : s.url" target="_blank"
    class="app" :class="{ down: !s.up }" :style="{ '--h': s.hue ?? 220 }"
    :title="s.up ? `${s.ms} ms${s.ct ? ` · CT ${s.ct}` : ''}` : `down${s.error ? `: ${s.error}` : ''}`"
  >
    <span class="icon"><AppLogo :name="s.name" /></span>
    <span class="body">
      <span class="name">{{ s.name }}</span>
      <span class="note">{{ s.up ? s.note : 'down' }}</span>
      <span class="facts">
        <span v-if="s.up && s.ms != null" class="num">{{ s.ms }} ms</span>
        <span v-if="s.ct">CT {{ s.ct }}</span>
        <span v-if="host(s.url)" class="mono">{{ host(s.url) }}</span>
      </span>
    </span>
    <span class="dot" :class="s.up ? 'ok' : 'bad'" />
  </a>
</template>

<style scoped>
.app {
  position: relative; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 14px;
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
  border-radius: var(--radius-sm); background: hsl(var(--h) 70% 60% / .14);
}
.icon :deep(img) { width: 62%; height: 62%; }
.body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app.down .note { color: var(--bad); }
.facts { display: none; flex-wrap: wrap; gap: 2px 10px; margin-top: 4px; font-size: 11.5px; color: var(--muted); min-width: 0; }
.facts .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.app .dot { width: 7px; height: 7px; box-shadow: none; }
@media (max-width: 640px) {
  .app { gap: 10px; padding: 10px; }
  .icon { width: 34px; height: 34px; font-size: 17px; }
  .app .dot { position: absolute; top: 8px; right: 8px; }
}
/* --- by the Home tile's shape --- */
.app { height: 100%; overflow: hidden; }
/* narrow (one column): icon over name */
@container tile (max-width: 129px) {
  .app { flex-direction: column; gap: 6px; padding: 8px 6px; justify-content: center; text-align: center; }
  .body { align-items: center; max-width: 100%; flex: none; }
  .name { font-size: 12px; font-weight: 500; max-width: 100%; }
  .note { display: none; }
  .app .dot { position: absolute; top: 8px; right: 8px; }
}
/* tall: a bigger icon on top, then name, note and the facts */
@container tile (min-height: 120px) {
  .app { flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 8px; }
  .body { flex: 1; min-height: 0; width: 100%; }
  .name, .note { flex: none; }
  /* the facts take what room is left and lose whole lines, never squeeze the name */
  .facts { display: flex; min-height: 0; overflow: hidden; }
  .facts .mono { display: none; }
  .app .dot { position: absolute; top: 12px; right: 12px; }
}
@container tile (min-height: 120px) and (max-width: 129px) {
  .app { align-items: center; justify-content: center; }
  .facts { flex-direction: column; align-items: center; }
  .facts .mono { display: none; }
}
@container tile (min-height: 200px) and (min-width: 260px) {
  .icon { width: 56px; height: 56px; font-size: 28px; }
  .name { font-size: 18px; }
  .note { font-size: 13px; }
  .facts { font-size: 12.5px; }
  .facts .mono { display: block; }
}
</style>
