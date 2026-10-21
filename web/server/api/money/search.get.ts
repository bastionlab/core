/** search every booking of the history window: payee, purpose, category or an amount */
export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim().slice(0, 80)
  return money(event, '/tx/search', { query: { q, limit: 300 } })
})
