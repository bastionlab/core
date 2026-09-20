<script setup lang="ts">
const props = defineProps<{ item: any, busy?: boolean }>()
const emit = defineEmits<{ (e: 'verdict', v: 'up' | 'down' | null): void }>()

const price = computed(() => {
  const i = props.item
  if (i.price_type === 'free') return 'Zu verschenken'
  if (i.price_eur == null) return 'VB'
  return `${i.price_eur.toLocaleString('de-DE')} €${i.price_type === 'negotiable' ? ' VB' : ''}`
})
// posted_at is what the seller's clock says; first_seen_at is when we caught it
const when = computed(() => ago(props.item.posted_at ?? props.item.first_seen_at))
const fresh = computed(() => (Date.now() / 1000 - (props.item.posted_at ?? 0)) < 3600)
const vote = (v: 'up' | 'down') => emit('verdict', props.item.verdict === v ? null : v)
</script>

<template>
  <article class="card" :class="{ down: item.verdict === 'down' }">
    <a :href="item.url" target="_blank" rel="noopener" class="shot">
      <img v-if="item.image_url" :src="item.image_url" :alt="item.title" loading="lazy">
      <div v-else class="noshot">🏷️</div>
    </a>

    <div class="body">
      <div class="head">
        <a :href="item.url" target="_blank" rel="noopener" class="title">{{ item.title }}</a>
        <!-- no score yet: phase 4 fills m.score and this becomes the deal badge -->
        <span v-if="item.score != null" class="pill accent">{{ Math.round(item.score) }}</span>
      </div>

      <div class="price">{{ price }}</div>

      <div class="meta small muted">
        <span v-if="item.district">{{ item.district }}</span>
        <span v-if="item.distance_km != null">{{ item.distance_km.toFixed(0) }} km</span>
        <span v-if="item.shipping" class="pill">📦 Versand</span>
        <span :class="{ accent: fresh }">{{ when }}</span>
      </div>

      <div class="foot">
        <span class="pill">{{ item.search_name }}</span>
        <div class="votes">
          <button class="btn ghost" :class="{ on: item.verdict === 'up' }" :disabled="busy" title="Good match" @click="vote('up')">👍</button>
          <button class="btn ghost" :class="{ on: item.verdict === 'down' }" :disabled="busy" title="Not what I want" @click="vote('down')">👎</button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card { display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; min-width: 0; }
.card.down { opacity: .45; }
.shot { display: block; aspect-ratio: 4 / 3; background: var(--panel-2); }
.shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.noshot { width: 100%; height: 100%; display: grid; place-items: center; font-size: 28px; opacity: .35; }
.body { padding: 10px 12px 8px; display: flex; flex-direction: column; gap: 5px; flex: 1; }
.head { display: flex; gap: 8px; align-items: flex-start; }
.title { flex: 1; min-width: 0; font-weight: 600; font-size: 13.5px; line-height: 1.3; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.price { font-size: 16px; font-weight: 700; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
.meta .accent { color: var(--accent); font-weight: 600; }
.foot { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 6px; }
.votes { margin-left: auto; display: flex; gap: 2px; }
.votes .btn { padding: 3px 6px; font-size: 13px; }
.votes .btn.on { background: var(--accent-soft); }
</style>
