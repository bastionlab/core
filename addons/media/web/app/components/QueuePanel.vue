<script setup lang="ts">
const props = defineProps<{ title: string, sub?: string, items: any[], empty?: string, id?: string }>()
const list = computed(() => props.items ?? [])
const active = computed(() => [...new Set(list.value.filter(i => (i.speed ?? 0) > 0).map(i => i.hash ?? i.id))])
const eta = (s?: string | null) => (!s ? null : s.replace(/^00:/, '').replace(/\.\d+$/, ''))
// A download at 0% is not news; one that has had no bytes for an hour is. qb-watchdog
// repairs it after a few more, so this is the warning the row shows in between.
const stuck = (i: any) => !i.speed && typeof i.idleHours === 'number' && i.idleHours >= 1

// The *arr call anything handed to the client "downloading", including the ~60 torrents
// qBittorrent is only holding in its queue - so the tag comes from the torrent's own state.
const TAGS: Record<string, { rank: number, tone: string }> = {
  downloading: { rank: 0, tone: 'accent' },
  importing: { rank: 1, tone: 'warn' },
  error: { rank: 2, tone: 'bad' },
  stalled: { rank: 3, tone: 'warn' },
  'no metadata': { rank: 4, tone: 'warn' },
  queued: { rank: 5, tone: '' },
  paused: { rank: 6, tone: '' },
  done: { rank: 7, tone: 'ok' },
}
function tag(i: any): string {
  const t = i.torrentState ?? ''
  if (i.error || i.status === 'failed' || t === 'error' || t === 'missingFiles') return 'error'
  if (i.state === 'importPending' || i.state === 'importing') return 'importing'
  if (i.speed > 0 || t === 'downloading' || t === 'forcedDL') return 'downloading'
  if (t === 'metaDL' || t === 'forcedMetaDL') return 'no metadata'
  if (t === 'stalledDL') return 'stalled'
  if (t === 'queuedDL' || i.status === 'queued') return 'queued'
  if (t === 'pausedDL' || t === 'stoppedDL' || i.status === 'paused') return 'paused'
  if (i.progress >= 100) return 'done'
  return i.state ?? i.status ?? '–'
}
const rank = (t: string) => TAGS[t]?.rank ?? 9
const tone = (t: string) => TAGS[t]?.tone ?? ''

// "S03E21 · title" -> sortable 3021; movies and books have no episode
const epNum = (i: any) => {
  const m = /^S(\d+)E(\d+)/.exec(i.sub ?? '')
  return m ? +m[1] * 1000 + +m[2] : 0
}

// One torrent can sit behind several queue rows (a season pack is one row per episode),
// so bytes and speed are counted once per torrent, never once per row.
const perTorrent = (items: any[]) => [...new Map(items.map(i => [i.hash ?? i.id, i])).values()]
const sum = (items: any[], k: string) => perTorrent(items).reduce((s, i) => s + (i[k] || 0), 0)

// "S01E01..E08" for a pack, the episode's own line otherwise
function packLabel(items: any[]) {
  const eps = items.map(i => /^S(\d+)E(\d+)/.exec(i.sub ?? '')).filter(Boolean) as RegExpExecArray[]
  if (!eps.length) return `${items.length} episodes`
  const seasons = [...new Set(eps.map(m => m[1]))]
  if (seasons.length > 1) return `S${seasons.join(' + S')} · ${items.length} episodes`
  return `S${seasons[0]}E${eps[0][2]}–E${eps[eps.length - 1][2]} · ${items.length} episodes`
}

interface Row { key: string, label: string, pack: boolean, lead: any, items: any[] }
interface Group { key: string, title: string, items: any[], rows: Row[], tags: [string, number][], best: number,
  size: number, left: number, speed: number, seasons: string }

const groups = computed<Group[]>(() => {
  const by = new Map<string, any[]>()
  for (const i of list.value) {
    const k = `${i.kind}:${i.title ?? i.release ?? i.id}`
    by.set(k, [...(by.get(k) ?? []), { ...i, tag: tag(i) }])
  }
  return [...by.entries()].map(([key, items]) => {
    items.sort((a, b) => rank(a.tag) - rank(b.tag) || epNum(a) - epNum(b))
    const byHash = new Map<string, any[]>()
    for (const i of items) {
      const h = i.hash ?? `id:${i.id}`
      byHash.set(h, [...(byHash.get(h) ?? []), i])
    }
    const rows: Row[] = [...byHash.entries()].map(([h, xs]) => ({
      key: h, items: xs, lead: xs[0], pack: xs.length > 1,
      label: xs.length > 1 ? packLabel(xs) : (xs[0].sub || xs[0].release),
    }))
    const counts = new Map<string, number>()
    for (const i of items) counts.set(i.tag, (counts.get(i.tag) ?? 0) + 1)
    const seasons = [...new Set(items.map(i => /^S(\d+)/.exec(i.sub ?? '')?.[0]).filter(Boolean))].sort()
    return {
      key, items, rows, title: items[0].title ?? items[0].release,
      tags: [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0])),
      best: rank(items[0].tag),
      size: sum(items, 'size'), left: sum(items, 'left'), speed: sum(items, 'speed'),
      seasons: seasons.join(' · '),
    }
  }).sort((a, b) => a.best - b.best || b.speed - a.speed || a.title.localeCompare(b.title))
})
const pct = (g: Group) => (g.size ? Math.round(1000 * (g.size - g.left) / g.size) / 10 : 0)

// survives the 8 s poll re-render
const open = useState<string[]>(`queue:open:${props.id ?? props.title}`, () => [])
const toggle = (k: string) => {
  open.value = open.value.includes(k) ? open.value.filter(x => x !== k) : [...open.value, k]
}
</script>

<template>
  <Panel :id="id" :title="title" :sub="sub ?? (list.length ? `${groups.length} title${groups.length === 1 ? '' : 's'}${active.length ? ` · ${active.length} downloading` : ''}` : '')">
    <div v-if="!list.length" class="faint small">{{ empty ?? 'Nothing downloading' }}</div>
    <div v-for="g in groups" :key="g.key" class="item" :class="{ err: g.items.length === 1 && g.items[0].tag === 'error' }">
      <!-- one download: the full row, as before -->
      <template v-if="g.items.length === 1">
        <template v-for="i in g.items" :key="i.id">
          <div v-if="i.error && !i.title" class="small bad">{{ i.error }}</div>
          <template v-else>
            <div class="head">
              <b class="title">{{ i.title ?? i.release }}</b>
              <span class="pill" :class="tone(i.tag)">{{ i.tag }}</span>
            </div>
            <div v-if="i.sub" class="small muted sub">{{ i.sub }}</div>
            <div class="track"><i :style="{ width: Math.max(1, i.progress || 0) + '%' }" /></div>
            <div class="small muted meta">
              <span>{{ i.progress }}% of {{ bytes(i.size) }}</span>
              <span v-if="i.speed">{{ bytes(i.speed) }}/s</span>
              <span v-if="eta(i.eta)">eta {{ eta(i.eta) }}</span>
              <span v-if="i.seeds != null">{{ i.seeds }} seeds</span>
              <span v-if="stuck(i)" class="warn">nothing for {{ i.idleHours }} h</span>
              <span v-if="i.ratio != null">ratio {{ i.ratio }}</span>
            </div>
            <div v-if="i.error" class="small bad">{{ i.error }}</div>
            <div v-for="(m, k) in i.messages ?? []" :key="k" class="small warn">{{ m }}</div>
          </template>
        </template>
      </template>

      <!-- a series: one summary row, episodes on demand -->
      <template v-else>
        <button class="head group" :aria-expanded="open.includes(g.key)" @click="toggle(g.key)">
          <Icon name="arrow" :size="14" class="chev" :class="{ on: open.includes(g.key) }" />
          <b class="title">{{ g.title }}</b>
          <span class="tags">
            <span v-for="[t, n] in g.tags" :key="t" class="pill" :class="tone(t)">{{ n }} {{ t }}</span>
          </span>
        </button>
        <div class="small muted sub indent">{{ g.items.length }} episodes<template v-if="g.seasons"> · {{ g.seasons }}</template></div>
        <div class="track indent"><i :style="{ width: Math.max(1, pct(g)) + '%' }" /></div>
        <div class="small muted meta indent">
          <span>{{ pct(g) }}% of {{ bytes(g.size) }}</span>
          <span v-if="g.speed">{{ bytes(g.speed) }}/s</span>
        </div>

        <div v-if="open.includes(g.key)" class="eps">
          <div v-for="r in g.rows" :key="r.key" class="ep" :class="{ err: r.lead.tag === 'error' }">
            <div class="head">
              <span class="title small">{{ r.label }}<span v-if="r.pack" class="faint"> · one torrent</span></span>
              <span class="small muted num">{{ r.lead.progress }}%<template v-if="r.lead.speed"> · {{ bytes(r.lead.speed) }}/s</template><template v-if="eta(r.lead.eta) && r.lead.speed"> · {{ eta(r.lead.eta) }}</template></span>
              <span class="pill" :class="tone(r.lead.tag)">{{ r.lead.tag }}</span>
            </div>
            <div v-if="r.lead.progress > 0 && r.lead.progress < 100" class="track thin"><i :style="{ width: r.lead.progress + '%' }" /></div>
            <div v-if="r.pack" class="small faint">{{ r.items.map(i => i.sub).join(' · ') }}</div>
            <div v-if="stuck(r.lead) && r.lead.tag !== 'queued'" class="small warn">nothing for {{ r.lead.idleHours }} h</div>
            <div v-if="r.lead.error" class="small bad">{{ r.lead.error }}</div>
            <div v-for="(m, k) in r.lead.messages ?? []" :key="k" class="small warn">{{ m }}</div>
          </div>
        </div>
      </template>
    </div>
  </Panel>
</template>

<style scoped>
.item { padding: 10px 0; }
.item:first-of-type { padding-top: 0; }
.item + .item { border-top: 1px solid var(--line); }
.head { display: flex; align-items: center; gap: 8px; }
.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { margin-top: 1px; }
.track { height: 4px; background: var(--track); border-radius: 3px; overflow: hidden; margin: 7px 0 5px; }
.track i { display: block; height: 100%; background: var(--accent); transition: width .6s ease; }
.track.thin { height: 3px; margin: 4px 0 2px; }
.item.err .track i, .ep.err .track i { background: var(--bad); }
.meta { display: flex; flex-wrap: wrap; gap: 4px 14px; }

button.group { width: 100%; background: none; border: 0; padding: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.chev { width: 14px; color: var(--muted); transition: transform .15s ease; flex: none; }
.chev.on { transform: rotate(90deg); }
.tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; flex: none; max-width: 55%; }
.indent { margin-left: 20px; }
.eps { margin: 8px 0 0 20px; border-left: 2px solid var(--line); padding-left: 10px; }
.ep { padding: 5px 0; }
.ep + .ep { border-top: 1px dashed var(--line); }
.num { flex: none; font-variant-numeric: tabular-nums; }
</style>
