/** chats changed since `since` (a server seq), plus ids deleted since then; `ids=a,b` returns just those chats (current state) */
export default defineEventHandler((event) => {
  const { since, ids } = getQuery(event)
  if (ids) return chatsByIds(String(ids).split(',').filter(id => /^[\w-]{1,40}$/.test(id)).slice(0, 100))
  return chatsSince(Math.max(0, Number(since) || 0))
})
