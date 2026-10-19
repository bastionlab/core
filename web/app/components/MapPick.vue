<script setup lang="ts">
/**
 * Leaflet map for the flat search form. Pin mode: click drops the pin and the
 * circle follows the radius. City mode: shows the resolved place's bounding
 * box (plus margin) read-only, so you can see what "Berlin" actually covers.
 */
import 'leaflet/dist/leaflet.css'

const props = defineProps<{
  mode: 'city' | 'pin'
  lat: number | null
  lon: number | null
  radius: number // km
  bbox?: [number, number, number, number] | null // s, n, w, e
}>()
const emit = defineEmits<{ (e: 'pick', v: { lat: number, lon: number }): void }>()

const el = ref<HTMLElement | null>(null)
let L: any, map: any, pin: any, circle: any, box: any

// Leaflet writes colours into SVG attributes, where var() does not resolve
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3d63dd'

function draw() {
  if (!map) return
  const color = accent()
  for (const layer of [pin, circle, box]) layer?.remove()
  pin = circle = box = null
  if (props.mode === 'pin' && props.lat != null && props.lon != null) {
    pin = L.circleMarker([props.lat, props.lon], { radius: 6, weight: 2, color, fillOpacity: 1 }).addTo(map)
    circle = L.circle([props.lat, props.lon], { radius: (props.radius || 0.5) * 1000, weight: 1.5, color, fillOpacity: 0.12 }).addTo(map)
    map.fitBounds(circle.getBounds(), { padding: [12, 12], maxZoom: 14 })
  } else if (props.mode === 'city' && props.bbox) {
    const [s, n, w, e] = props.bbox
    const m = (props.radius || 0) / 111
    const mlon = m / Math.max(0.2, Math.cos((((s + n) / 2) * Math.PI) / 180))
    box = L.rectangle([[s - m, w - mlon], [n + m, e + mlon]], { weight: 1.5, color, fillOpacity: 0.08 }).addTo(map)
    map.fitBounds(box.getBounds(), { padding: [12, 12] })
  }
}

onMounted(async () => {
  L = (await import('leaflet')).default
  if (!el.value) return
  map = L.map(el.value, { zoomControl: true, attributionControl: true }).setView([props.lat ?? 52.52, props.lon ?? 13.405], 11)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap',
  }).addTo(map)
  map.on('click', (ev: any) => {
    if (props.mode === 'pin') emit('pick', { lat: +ev.latlng.lat.toFixed(5), lon: +ev.latlng.lng.toFixed(5) })
  })
  draw()
})
onUnmounted(() => map?.remove())
watch(() => [props.mode, props.lat, props.lon, props.radius, props.bbox], draw, { deep: true })
</script>

<template>
  <div ref="el" class="map" :class="{ picking: mode === 'pin' }" />
</template>

<style scoped>
.map { height: 260px; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; background: var(--panel-2); z-index: 0; }
.map.picking { cursor: crosshair; }
.map :deep(.leaflet-container) { font: inherit; }
.map :deep(.leaflet-control-attribution) { font-size: 10px; }
/* the same dark as the rest of the page instead of a white slab */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .map :deep(.leaflet-tile-pane) { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9); }
}
:root[data-theme="dark"] .map :deep(.leaflet-tile-pane) { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9); }
</style>
