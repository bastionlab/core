/** every API route needs the PIN cookie, except the login endpoints themselves */
export default defineEventHandler((event) => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/') || path.startsWith('/api/auth/')) return
  if (validCookie(event) || fromInsideCt(event)) return
  throw createError({ statusCode: 401, statusMessage: 'locked' })
})
