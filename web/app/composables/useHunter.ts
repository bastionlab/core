import type { WatchSource } from 'vue'

/**
 * The shared half of the three "hunter" pages (deals, wohnungen, jobs): one CT 107 feed filtered per search tab
 * and per view, polled, with 👍/👎 feedback. The feed is filtered server-side, not in the browser: with several
 * searches a shared row limit would let a busy search crowd a quiet one out of its own tab.
 *
 * `query` builds the request from the page's own filters; `watched` are those filters, so a change reloads.
 */
export function useHunter(api: '/api/deals' | '/api/flats' | '/api/jobs', every: number, query: (selected: number | null) => Record<string, any>, watched: WatchSource[] = []) {
  const selected = ref<number | null>(null)
  const d = ref<any>(null)
  const error = ref<any>(null)
  const pending = ref(false)

  // a poll and a tab click can overlap: only the newest request's answer lands
  let seq = 0
  async function load() {
    const my = ++seq
    pending.value = true
    try {
      const r = await $fetch(api, { query: query(selected.value) })
      if (my === seq) { d.value = r; error.value = null }
    } catch (e: any) { if (my === seq) error.value = e } finally { if (my === seq) pending.value = false }
  }
  usePoll(load, every)
  watch([selected, ...watched], load)

  const searches = computed<any[]>(() => d.value?.searches ?? [])
  const st = computed(() => d.value?.status)
  const counts = computed(() => d.value?.counts ?? { per_search: {}, total: 0 })
  const feed = computed<any[]>(() => d.value?.feed ?? [])
  const tabs = (hits: (id: number | null) => number = id => (id === null ? counts.value.total : counts.value.per_search?.[String(id)] ?? 0)) => [
    { id: null as number | null, name: 'Alle', hits: hits(null), enabled: true },
    ...searches.value.map((s: any) => ({ id: s.id as number | null, name: s.name as string, hits: hits(s.id), enabled: !!s.enabled })),
  ]

  /** optimistic feedback: `apply` changes the card now, `undo` puts it back if the call fails; then the feed
   *  reloads, because a 👍 / 👎 / applied moves the item between views and changes the counts */
  const busyItem = ref('')
  async function feedback(item: any, body: Record<string, any>, apply: () => void, undo: () => void) {
    busyItem.value = item.source + item.source_id
    apply()
    try {
      await $fetch(`${api}/action`, { method: 'POST', body: { searchId: item.search_id, source: item.source, sourceId: item.source_id, ...body } })
      load()
    } catch { undo() } finally { busyItem.value = '' }
  }
  function verdict(item: any, v: 'up' | 'down' | null) {
    const before = item.verdict
    return feedback(item, { action: 'feedback', verdict: v }, () => { item.verdict = v }, () => { item.verdict = before })
  }
  const isBusy = (item: any) => busyItem.value === item.source + item.source_id

  /** after a search was added, edited or deleted. Checked against the fresh list: a deleted search must not stay
   *  selected, or the feed asks for rows that cannot exist */
  async function onChanged() {
    await load()
    if (selected.value !== null && !searches.value.some((s: any) => s.id === selected.value)) selected.value = null
  }

  return { selected, d, error, pending, load, searches, st, counts, feed, tabs, feedback, verdict, isBusy, onChanged }
}
