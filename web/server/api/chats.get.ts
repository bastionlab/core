/** chats changed since `since` (a server seq), plus ids deleted since then */
export default defineEventHandler(event => chatsSince(Math.max(0, Number(getQuery(event).since) || 0)))
