/** a game server's console tail (docker logs) + the log of its last background op */
export default defineEventHandler((event) => {
  const { id, n } = getQuery(event)
  return agent(event, `/games/log?${new URLSearchParams({ id: String(id ?? ''), n: String(n ?? 300) })}`)
})
