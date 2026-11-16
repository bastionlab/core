/** the turn the agent started for a chat's send (found by the nonce the page sent): the page asks after a send that got no answer */
export default defineEventHandler((event) => {
  const { chat, nonce } = getQuery(event)
  if (!chat || !nonce) throw createError({ statusCode: 400, statusMessage: 'missing chat or nonce' })
  return agent(event, `/claude/latest?${new URLSearchParams({ chat: String(chat), nonce: String(nonce) })}`)
})
