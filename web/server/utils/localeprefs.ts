import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { H3Event } from 'h3'

/** per-person display preferences (language, date and money format), keyed by Tailscale login; /var/lib/dash/locale.json */
const DIR = process.env.NOTES_DIR || '/var/lib/dash'
const FILE = `${DIR}/locale.json`

const LANGS = ['en', 'de']
const DATE_LOCALES = ['en-GB', 'de-DE', 'en-US', 'fr-FR']
const MONEY_LOCALES = ['de-DE', 'en-IE', 'fr-FR']
export type LocalePrefs = { lang: string, date: string, money: string }
const DEFAULTS: LocalePrefs = { lang: 'en', date: 'en-GB', money: 'de-DE' }

const who = (event: H3Event) => (ownerLogin(event) ? String(event.node.req.headers['tailscale-user-login']).toLowerCase() : fromLan(event) ? 'lan' : 'local')

function all(): Record<string, LocalePrefs> {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {} } catch { return {} }
}

export function getLocalePrefs(event: H3Event): LocalePrefs {
  return { ...DEFAULTS, ...all()[who(event)] }
}

export function setLocalePrefs(event: H3Event, p: Partial<LocalePrefs>): LocalePrefs {
  const cur = getLocalePrefs(event)
  const pick = (v: string | undefined, ok: string[], old: string) => (v && ok.includes(v) ? v : old)
  const next = { lang: pick(p.lang, LANGS, cur.lang), date: pick(p.date, DATE_LOCALES, cur.date), money: pick(p.money, MONEY_LOCALES, cur.money) }
  const a = all()
  a[who(event)] = next
  writeFileSync(`${FILE}.tmp`, JSON.stringify(a, null, 2))
  renameSync(`${FILE}.tmp`, FILE)
  return next
}
