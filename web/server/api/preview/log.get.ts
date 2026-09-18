export default defineEventHandler(event => agent(event, '/preview/log', { query: getQuery(event) }))
