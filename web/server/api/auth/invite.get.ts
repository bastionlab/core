/** is this invite link still good, and for which role */
export default defineEventHandler((event) => {
  const i = inviteFor(String(getQuery(event).t ?? ''))
  if (!i) throw createError({ statusCode: 404, statusMessage: 'This invite has expired or was used.' })
  return i
})
