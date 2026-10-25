/** stable or beta: which releases this box is offered */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  return agent(event, '/core/channel', { method: 'POST', body: { channel: String(b?.channel ?? '') }, timeout: 100_000 })
})
