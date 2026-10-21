/** which Discord channels have a webhook (never the URLs) */
export default defineEventHandler(event => agent(event, '/discord'))
