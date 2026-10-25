/** upload a backup from another host (or an older download): the body streams to the agent, which checks it */
export default defineEventHandler(async (event) => {
  const name = String(getQuery(event).name ?? '')
  if (!/^dash-[a-z0-9-]{1,40}-\d{8}-\d{6}\.tar\.gz$/.test(name)) throw createError({ statusCode: 400, statusMessage: 'the file must be a dashboard backup (dash-<host>-<date>-<time>.tar.gz)' })
  const size = Number(getHeader(event, 'content-length') || 0)
  if (!size) throw createError({ statusCode: 411, statusMessage: 'length required' })
  const { agentUrl, agentToken } = useRuntimeConfig(event)
  const res = await fetch(`${agentUrl}/backup/upload?name=${name}`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${agentToken}`, 'Content-Length': String(size), 'Content-Type': 'application/gzip' },
    body: event.node.req as any, duplex: 'half',
  } as any).catch((e: any) => { throw createError({ statusCode: 502, statusMessage: `agent: ${e?.message}` }) })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) throw createError({ statusCode: res.status === 400 ? 400 : 502, statusMessage: j.error || 'upload failed' })
  return j
})
