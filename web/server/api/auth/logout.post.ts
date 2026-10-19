export default defineEventHandler((event) => {
  deleteCookie(event, COOKIE, { path: '/' })
  return { ok: true }
})
