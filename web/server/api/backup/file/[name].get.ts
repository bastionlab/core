/** download one backup: the agent's bytes piped straight through */
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') ?? ''
  if (!/^dash-[a-z0-9-]{1,40}-\d{8}-\d{6}\.tar\.gz$/.test(name)) throw createError({ statusCode: 400, statusMessage: 'bad backup name' })
  const { agentUrl, agentToken } = useRuntimeConfig(event)
  const res = await fetch(`${agentUrl}/backup/file?name=${name}`, { headers: { Authorization: `Bearer ${agentToken}` } }).catch((e: any) => {
    throw createError({ statusCode: 502, statusMessage: `agent: ${e?.message}` })
  })
  if (!res.ok || !res.body) throw createError({ statusCode: res.status === 400 ? 404 : 502, statusMessage: (await res.text()).slice(0, 200) })
  setResponseHeaders(event, { 'Content-Type': 'application/gzip', 'Content-Length': res.headers.get('content-length') ?? '', 'Content-Disposition': `attachment; filename="${name}"` })
  return sendStream(event, res.body)
})
