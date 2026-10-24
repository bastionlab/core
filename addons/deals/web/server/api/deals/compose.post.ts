/**
 * Proxy the self-correcting compose loop in CT 107.
 *
 * It lives there rather than here because it has to actually run the search it
 * just wrote -- a single-shot prompt produces filters that look right and match
 * the wrong things, and only real results reveal that. Streams NDJSON because
 * a draft-probe-critique-probe cycle takes tens of seconds.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const prompt = String(body?.prompt ?? '').trim().slice(0, 600)
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'describe what you are looking for' })

  const { dealsUrl, dealsToken } = useRuntimeConfig(event)
  const upstream = await fetch(`${dealsUrl}/compose`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${dealsToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!upstream.ok || !upstream.body)
    throw createError({ statusCode: 502, statusMessage: `deals: compose failed (${upstream.status})` })

  setResponseHeaders(event, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
  })
  return upstream.body
})
