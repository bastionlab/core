/** what the login page offers: PIN pad, name + password, passkey (only on a host name, never on the LAN IP) */
export default defineEventHandler((event) => {
  const s = session(event)
  return {
    ok: !!s || fromInsideCt(event),
    configured: pinConfigured(event),
    accounts: anyUsers(),
    passkeys: anyPasskeys() && passkeyRp(event).ok,
    user: s?.uid ? publicUser(userById(s.uid)) : null,
    role: s ? (s.uid ? userById(s.uid)?.role ?? null : 'owner') : fromInsideCt(event) ? 'owner' : null,
  }
})
