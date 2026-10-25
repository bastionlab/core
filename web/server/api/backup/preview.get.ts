/** what restoring one backup would replace */
export default defineEventHandler(event => agent(event, '/backup/preview', { query: { name: String(getQuery(event).name ?? '') }, timeout: 300_000 }))
