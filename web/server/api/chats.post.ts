/** { put: [chat…], del: [id…] } — each chat carries its own `upd`; stale writes are ignored */
const okId = (v: any) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v)

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  for (const id of (Array.isArray(body?.del) ? body.del : []).filter(okId)) dropChat(id)
  const rejected: { id: string, reason: string }[] = []
  for (const c of Array.isArray(body?.put) ? body.put : []) {
    if (!okId(c?.id) || !Array.isArray(c.turns)) continue
    const { upd, ...rest } = c
    const data = JSON.stringify(rest)
    if (data.length > 5_000_000) { rejected.push({ id: c.id, reason: 'size' }); continue }
    // a device with a wrong clock must not win every later edit: never trust an edit time past now + 1 min
    const res = putChat(c.id, Math.min(Math.round(Number(upd)) || Date.now(), Date.now() + 60_000), data)
    if (!res.ok) rejected.push({ id: c.id, reason: res.reason })
  }
  return { seq: chatSeq(), rejected }
})
