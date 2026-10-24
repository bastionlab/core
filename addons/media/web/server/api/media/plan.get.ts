/** what removing one series/film (or some seasons of a series) would delete: its files and the torrents seeding them */
export default defineEventHandler((event) => {
  const { kind, id, seasons } = getQuery(event)
  return agent(event, '/media/plan', { query: { kind: String(kind ?? ''), id: String(id ?? ''), ...(seasons ? { seasons: String(seasons) } : {}) } })
})
