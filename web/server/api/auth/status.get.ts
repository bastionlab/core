export default defineEventHandler(event => ({ ok: validCookie(event) || fromInsideCt(event), configured: pinConfigured(event) }))
