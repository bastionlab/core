/** the month-end report as text, for a preview */
export default defineEventHandler((event) => {
  const m = String(getQuery(event).month ?? '')
  if (!/^\d{4}-\d{2}$/.test(m)) throw createError({ statusCode: 400, statusMessage: 'month?' })
  return money(event, '/report', { query: { month: m }, timeout: 60_000 })
})
