export default defineEventHandler(event => agent(event, '/cc/log', { query: getQuery(event) }))
