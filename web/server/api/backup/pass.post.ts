/** the passphrase the secrets in a backup are encrypted with; write-only */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  return agent(event, '/backup/pass', { method: 'POST', body: { pass: String(b?.pass ?? '').slice(0, 200) } })
})
