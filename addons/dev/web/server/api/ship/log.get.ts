export default defineEventHandler(event => agent(event, '/ship/log', { query: getQuery(event) }))
