/** Settings → Account: who you are, your passkeys, whether a code is set up */
export default defineEventHandler((event) => {
  const uid = Number(event.context.uid || 0)
  const u = uid ? userById(uid) : undefined
  return {
    user: publicUser(u),
    accounts: !!pinUser(), // an owner account exists (invited people alone don't count)
    passkeys: u ? passkeysOf(u.id) : [],
    passkeyHost: passkeyRp(event).ok ? passkeyRp(event).id : null,
  }
})
