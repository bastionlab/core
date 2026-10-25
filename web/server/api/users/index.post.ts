/** owner only: invite (returns the one-time link) · invite-drop · role · remove · guests */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const bad = (m: string) => { throw createError({ statusCode: 400, statusMessage: m }) }
  const me = Number(event.context.uid || 0)
  try {
    switch (String(b?.op ?? '')) {
      case 'invite': {
        if (!isRole(b.role)) bad('unknown role')
        const token = createInvite(b.role, me)
        const h = event.node.req.headers
        return { link: `https://${String(h['x-forwarded-host'] || h.host)}/login?invite=${token}` }
      }
      case 'invite-drop': dropInvite(String(b.id ?? '')); return { ok: true }
      case 'role':
        if (!isRole(b.role)) bad('unknown role')
        setRole(Number(b.id), b.role); return { ok: true }
      case 'remove':
        if (Number(b.id) === me) bad('you can\'t remove yourself')
        removeUser(Number(b.id)); return { ok: true }
      case 'guests': metaSet('tailnet_guests', b.on ? '1' : '0'); return { ok: true }
    }
  } catch (e: any) {
    if (e?.statusCode) throw e
    bad(e?.message || 'failed')
  }
  bad('unknown op')
})
