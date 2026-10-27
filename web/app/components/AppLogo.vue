<script setup lang="ts">
/** the app's own logo (public/app-icons/<slug>.svg), or a generic icon when there is none */
const props = defineProps<{ name: string, size?: number }>()
const LOGOS = new Set(['immich', 'jellyfin', 'audiobookshelf', 'proxmox', 'open-webui', 'ollama', 'seerr', 'qbittorrent', 'radarr', 'sonarr', 'bazarr', 'navidrome', 'lidarr'])
const slug = computed(() => props.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
</script>

<template>
  <img v-if="LOGOS.has(slug)" class="logo" :src="`/app-icons/${slug}.svg`" :alt="name" :width="size ?? 26" :height="size ?? 26" loading="lazy">
  <Icon v-else name="grid" :size="size ?? 22" />
</template>

<style scoped>
.logo { display: block; object-fit: contain; }
</style>
