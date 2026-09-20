/** the whole deals page in one call: poller health, the saved searches and the feed */
export default defineEventHandler(async (event) => {
  const { search, limit, verdict, shipping, show, hideDown } = getQuery(event)
  // counts and feed share these, so a tab can never claim a number the tab does not contain
  const view = {
    verdict: verdict || undefined,
    shipping: shipping || undefined,
    show: show || 'passed',
    hide_down: hideDown === 'true' || hideDown === true,
  }
  const [status, searches, feed, counts] = await Promise.all([
    deals(event, '/status'),
    deals(event, '/searches'),
    deals(event, '/feed', { query: { ...view, limit: Number(limit) || 60, search: search || undefined } }),
    deals(event, '/counts', { query: view }),
  ])
  return { status, searches, feed, counts }
})
