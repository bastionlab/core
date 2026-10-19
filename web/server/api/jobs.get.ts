/** the whole Jobs page in one call: hunter health, saved searches, the list and its tab counts */
export default defineEventHandler(async (event) => {
  const { search, show, limit } = getQuery(event)
  const view = { show: ['passed', 'rejected', 'pending', 'applied'].includes(String(show)) ? show : 'passed' }
  const [status, searches, feed, counts] = await Promise.all([
    deals(event, '/jobs/status'),
    deals(event, '/jobs/searches'),
    deals(event, '/jobs/feed', { query: { ...view, limit: Number(limit) || 150, search: search || undefined } }),
    deals(event, '/jobs/counts', { query: view }),
  ])
  return { status, searches, feed, counts }
})
