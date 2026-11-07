/** the Google client ID (never the secret) and the connected accounts */
export default defineEventHandler(event => agent(event, '/google/accounts'))
