/**
 * The write half of the Money page. Allowlisted actions, every argument rebuilt; nothing forwarded as-is.
 */

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const action = cleanStr(body?.action, 20)
  const post = (path: string, b: any = {}, timeout = 30_000) => money(event, path, { method: 'POST', body: b, timeout })
  switch (action) {
    case 'sync': return post('/sync')
    case 'ebConfig': {
      const pem = String(body.keyPem ?? '').trim().slice(0, 10_000)
      if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) throw createError({ statusCode: 400, statusMessage: 'That does not look like a private key (.pem)' })
      return post('/eb/config', { app_id: cleanStr(body.appId, 64), key_pem: pem })
    }
    case 'ebAspsps': return money(event, '/eb/aspsps', { query: { country: cleanStr(body.country, 2) || 'DE' } })
    case 'ebLink': return post('/eb/link', { aspsp: cleanStr(body.aspsp, 120), country: cleanStr(body.country, 2) || 'DE' })
    case 'ebFinish': return post('/eb/finish', { code: cleanStr(body.code, 400), state: cleanStr(body.state, 64) }, 120_000)
    case 'ebUnlink': return post('/eb/unlink', { session_id: cleanStr(body.sessionId, 80) })
    case 'trConfig': return post('/tr/config', { phone: cleanStr(body.phone, 20), pin: cleanStr(body.pin, 8) })
    case 'trLogin': return post('/tr/login')
    case 'trCode': return post('/tr/code', { code: cleanStr(body.code, 10) }, 60_000)
    case 'category': return post('/tx/category', { group_id: cleanStr(body.groupId, 20), journal_id: cleanStr(body.journalId, 20), category: cleanStr(body.category, 40), scope: body.scope === 'payee' ? 'payee' : 'one' })
    case 'subDismiss': return post('/subs/dismiss', { key: cleanStr(body.key, 80) })
    case 'rename': return post('/payee/rename', { name: cleanStr(body.name, 200), alias: cleanStr(body.alias, 60) })
    case 'anomalyOk': return post('/anomalies/ok', { journal_id: cleanStr(body.journalId, 20) })
    case 'notifyTest': return post('/notify/test')
    case 'reportSend': return post('/report/send', { month: /^\d{4}-\d{2}$/.test(body.month) ? body.month : '' }, 60_000)
    case 'subRemove': return post('/subs/remove', { key: cleanStr(body.key, 80) })
    case 'subRestore': return post('/subs/restore', { key: cleanStr(body.key, 80) })
    case 'subEdit': return post('/subs/edit', { key: cleanStr(body.key, 80), period: body.period == null ? null : cleanStr(body.period, 12), name: body.name == null ? null : cleanStr(body.name, 80) })
    case 'subShare': {
      const ids = (Array.isArray(body.journalIds) ? body.journalIds : []).slice(0, 200).map((x: any) => cleanStr(x, 20)).filter(Boolean)
      return post('/subs/share', { key: cleanStr(body.key, 80), journal_ids: ids, remove: body.remove ? cleanStr(body.remove, 80) : null })
    }
    case 'subAdd': {
      const ids = (Array.isArray(body.journalIds) ? body.journalIds : []).slice(0, 200).map((x: any) => cleanStr(x, 20)).filter(Boolean)
      return post('/subs/add', { journal_ids: ids, period: body.period ? cleanStr(body.period, 12) : null, name: body.name ? cleanStr(body.name, 80) : null })
    }
  }
  throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })
})
