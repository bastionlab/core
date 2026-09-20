/** the whole deals page in one call: poller health, the saved searches and the feed */
export default defineEventHandler(async (event) => {
  const { search, limit, verdict, shipping } = getQuery(event)
  const [status, searches, feed] = await Promise.all([
    deals(event, '/status'),
    deals(event, '/searches'),
    deals(event, '/feed', { query: { limit: Number(limit) || 60, search: search || undefined, verdict: verdict || undefined, shipping: shipping || undefined } }),
  ])
  return { status, searches, feed }
})
