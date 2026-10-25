/** Add-ons → Core: this version, the channel's newest release + changelog, what blocks it, kept rollbacks */
export default defineEventHandler(event => agent(event, '/core', { query: getQuery(event).fresh === '1' ? { fresh: '1' } : {}, timeout: 100_000 }))
