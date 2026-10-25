/** change this person's language, date or money format (unknown values are ignored) */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  return setLocalePrefs(event, { lang: String(b?.lang ?? ''), date: String(b?.date ?? ''), money: String(b?.money ?? '') })
})
