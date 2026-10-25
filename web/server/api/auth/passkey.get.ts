/** a sign-in challenge; any passkey stored on the device for this host may answer it */
export default defineEventHandler((event) => {
  if (!passkeyRp(event).ok) throw createError({ statusCode: 400, statusMessage: 'passkeys need the host name, not an IP address' })
  return loginOptions(event)
})
