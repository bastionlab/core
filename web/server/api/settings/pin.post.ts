/** change the dashboard PIN (current + new); the agent checks the current one and restarts the app with the new hash */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  return agent(event, '/settings/pin', { method: 'POST', body: { current: String(b?.current ?? '').slice(0, 20), new: String(b?.new ?? '').slice(0, 20) } })
})
