/** every booking between two days (CSV export is built in the browser) */
export default defineEventHandler((event) => {
  const { start, end } = getQuery(event) as any
  const d = /^\d{4}-\d{2}-\d{2}$/
  if (!d.test(String(start)) || !d.test(String(end))) throw createError({ statusCode: 400, statusMessage: 'start/end?' })
  return money(event, '/tx/export', { query: { start, end }, timeout: 60_000 })
})
