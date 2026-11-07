/** save the Google OAuth client ID and secret (the secret stays on the agent) */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  return agent(event, '/google/client', { method: 'POST', body: { client_id: String(b?.client_id ?? '').slice(0, 300), client_secret: String(b?.client_secret ?? '').slice(0, 300) } })
})
