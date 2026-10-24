/** unusual charges of a month: far above the payee's usual, or charged twice the same day */
export default defineEventHandler((event) => {
  const m = String(getQuery(event).month ?? '')
  if (!/^\d{4}-\d{2}$/.test(m)) throw createError({ statusCode: 400, statusMessage: 'month?' })
  return money(event, '/anomalies', { query: { month: m } })
})
