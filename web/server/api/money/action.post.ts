/**
 * The write half of the Money page. Allowlisted actions, every argument rebuilt; nothing forwarded as-is.
 */
const str = (v: any, max = 120) => String(v ?? '').trim().slice(0, max)

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = str(body?.action, 20)
  const post = (path: string, b: any = {}, timeout = 30_000) => money(event, path, { method: 'POST', body: b, timeout })
  switch (action) {
    case 'sync': return post('/sync')
    case 'ebConfig': {
      const pem = String(body.keyPem ?? '').trim().slice(0, 10_000)
      if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) throw createError({ statusCode: 400, statusMessage: 'Das sieht nicht nach einem privaten Schlüssel (.pem) aus' })
      return post('/eb/config', { app_id: str(body.appId, 64), key_pem: pem })
    }
    case 'ebAspsps': return money(event, '/eb/aspsps', { query: { country: str(body.country, 2) || 'DE' } })
    case 'ebLink': return post('/eb/link', { aspsp: str(body.aspsp, 120), country: str(body.country, 2) || 'DE' })
    case 'ebFinish': return post('/eb/finish', { code: str(body.code, 400), state: str(body.state, 64) }, 120_000)
    case 'ebUnlink': return post('/eb/unlink', { session_id: str(body.sessionId, 80) })
    case 'trConfig': return post('/tr/config', { phone: str(body.phone, 20), pin: str(body.pin, 8) })
    case 'trLogin': return post('/tr/login')
    case 'trCode': return post('/tr/code', { code: str(body.code, 10) }, 60_000)
    case 'category': return post('/tx/category', { group_id: str(body.groupId, 20), journal_id: str(body.journalId, 20), category: str(body.category, 40) })
    case 'subDismiss': return post('/subs/dismiss', { key: str(body.key, 80) })
  }
  throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })
})
