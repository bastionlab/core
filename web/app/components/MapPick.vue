<script setup lang="ts">
/**
 * Leaflet map for the flat search form. Pin mode: click drops the pin and the
 * circle follows the radius. City mode: shows the resolved place's bounding
 * outline (plus margin as a dashed line), read-only, so you can see what
 * "Neukölln" actually covers. Places without an outline fall back to the box.
 */
import 'leaflet/dist/leaflet.css'

const props = defineProps<{
  mode: 'city' | 'pin'
  lat: number | null
  lon: number | null
  radius: number // km
  bbox?: [number, number, number, number] | null // s, n, w, e
  shape?: any | null // GeoJSON (Multi)Polygon of the place
}>()
const emit = defineEmits<{ (e: 'pick', v: { lat: number, lon: number }): void }>()

const el = ref<HTMLElement | null>(null)
let L: any, map: any, pin: any, circle: any, box: any, outline: any
let fitted: number | null = null // pin mode: the radius the view was last fitted to

// Leaflet writes colours into SVG attributes, where var() does not resolve
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3d63dd'

function draw() {
  if (!map) return
  const color = accent()
  for (const layer of [pin, circle, box, outline]) layer?.remove()
  if (props.mode !== 'pin' || props.lat == null) fitted = null
  pin = circle = box = outline = null
  if (props.mode === 'pin' && props.lat != null && props.lon != null) {
    pin = L.circleMarker([props.lat, props.lon], { radius: 6, weight: 2, color, fillOpacity: 1 }).addTo(map)
    circle = L.circle([props.lat, props.lon], { radius: (props.radius || 0.5) * 1000, weight: 1.5, color, fillOpacity: 0.12 }).addTo(map)
    // moving the pin inside the view keeps the view; it only follows when the circle no longer fits
    if (fitted !== props.radius || !map.getBounds().contains(circle.getBounds()))
      map.fitBounds(circle.getBounds(), { padding: [12, 12], maxZoom: 14 })
    fitted = props.radius
  } else if (props.mode === 'city' && props.shape) {
    outline = L.geoJSON(props.shape, { style: { weight: 2, color, fillOpacity: 0.1 } }).addTo(map)
    const b = outline.getBounds()
    if (props.radius > 0) {
      // the margin as a dashed box: an exact buffer is not worth a geometry library here
      const m = props.radius / 111
      const mlon = m / Math.max(0.2, Math.cos((b.getCenter().lat * Math.PI) / 180))
      box = L.rectangle([[b.getSouth() - m, b.getWest() - mlon], [b.getNorth() + m, b.getEast() + mlon]],
        { weight: 1, color, dashArray: '4 4', fill: false }).addTo(map)
    }
    map.fitBounds(box ? box.getBounds() : b, { padding: [12, 12] })
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
    // the site sends referrer-policy: same-origin; OSM refuses tile requests without a Referer
    referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map)
  map.on('click', (ev: any) => {
    if (props.mode === 'pin') emit('pick', { lat: +ev.latlng.lat.toFixed(5), lon: +ev.latlng.lng.toFixed(5) })
  })
  draw()
})
onUnmounted(() => map?.remove())
watch(() => [props.mode, props.lat, props.lon, props.radius, props.bbox, props.shape], draw, { deep: true })
</script>

<template>
  <div ref="el" class="map" :class="{ picking: mode === 'pin' }" />
</template>

<style scoped>
.map { height: 260px; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; background: var(--panel-2); z-index: 0; }
.map.picking { cursor: crosshair; }
.map :deep(.leaflet-container) { font: inherit; }
.map :deep(.leaflet-control-attribution) { font-size: 10px; background: rgba(10, 12, 16, .7); color: var(--muted); }
.map :deep(.leaflet-control-attribution a) { color: var(--muted); }
.map :deep(.leaflet-bar) { border: 1px solid var(--line-2); box-shadow: none; }
.map :deep(.leaflet-bar a) { background: var(--panel-2); color: var(--text); border-bottom-color: var(--line-2); }
/* the same dark as the rest of the page instead of a white slab */
.map :deep(.leaflet-tile-pane) { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9); }
</style>
