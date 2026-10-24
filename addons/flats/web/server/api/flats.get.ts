/** the whole Wohnungen page in one call: hunter health, saved searches, 👍 flats, the list and its tab counts */
export default defineEventHandler(async (event) => {
  const { search, show, limit } = getQuery(event)
  const view = { show: ['passed', 'all', 'rejected'].includes(String(show)) ? show : 'passed' }
  const [status, searches, liked, feed, counts] = await Promise.all([
    deals(event, '/flats/status'),
    deals(event, '/flats/searches'),
    deals(event, '/flats/liked'),
    deals(event, '/flats/feed', { query: { ...view, limit: Number(limit) || 150, search: search || undefined } }),
    deals(event, '/flats/counts', { query: view }),
  ])
  return { status, searches, liked, feed, counts }
})
