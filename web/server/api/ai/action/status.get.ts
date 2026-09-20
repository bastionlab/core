export default defineEventHandler(async (event) => {
  const { id } = getQuery(event)
  return agent(event, '/action/status', { query: { id: String(id ?? '') } })
})
