/** Google sends the browser back here (path is under /api/auth/ so it skips the session check; the agent checks the state) */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const sp = new URLSearchParams()
  for (const k of ['code', 'state', 'error']) if (q[k]) sp.set(k, String(q[k]).slice(0, 2000))
  let err = ''
  try {
    await agent(event, `/google/callback?${sp}`)
  } catch (e: any) { err = e?.statusMessage || e?.message || 'failed' }
  return sendRedirect(event, `/settings?s=connections${err ? `&google_err=${encodeURIComponent(err)}` : ''}`)
})
