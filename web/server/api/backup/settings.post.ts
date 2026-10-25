/** schedule (off/daily/weekly), how many to keep, where (a vzdump storage or the default dir) */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  return agent(event, '/backup/settings', { method: 'POST', body: { schedule: String(b?.schedule ?? 'off'), keep: Number(b?.keep) || 7, storage: String(b?.storage ?? '') } })
})
