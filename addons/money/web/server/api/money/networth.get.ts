/** account balances + depot per day, for the net worth chart */
export default defineEventHandler(event => money(event, '/networth', { timeout: 60_000 }))
