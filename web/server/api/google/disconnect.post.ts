/** forget one Google account's refresh token */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  return agent(event, '/google/disconnect', { method: 'POST', body: { email: String(b?.email ?? '').slice(0, 200) } })
})
