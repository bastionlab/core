/** { put: [chat…], del: [id…] } — each chat carries its own `upd`; stale writes are ignored */
const okId = (v: any) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v)

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  for (const id of (Array.isArray(body?.del) ? body.del : []).filter(okId)) dropChat(id)
  for (const c of Array.isArray(body?.put) ? body.put : []) {
    if (!okId(c?.id) || !Array.isArray(c.turns)) continue
    const { upd, ...rest } = c
    const data = JSON.stringify(rest)
    if (data.length > 5_000_000) continue
    putChat(c.id, Math.round(Number(upd)) || Date.now(), data)
  }
  return { seq: chatSeq() }
})
