/** all bookings with one payee + monthly totals + its subscriptions */
export default defineEventHandler((event) => {
  const name = String(getQuery(event).name ?? '').trim().slice(0, 200)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name fehlt' })
  return money(event, '/payee', { query: { name } })
})
