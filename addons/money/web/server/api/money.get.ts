/** the whole Money page in one call: accounts, month ledger, subscriptions, portfolio, setup state */
export default defineEventHandler(async (event) => {
  const { month } = getQuery(event)
  return money(event, '/overview', { query: { month: /^\d{4}-\d{2}$/.test(String(month)) ? month : undefined } })
})
