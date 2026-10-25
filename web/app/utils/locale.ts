/**
 * The viewer's language, date and money format (Settings → Language & format; /api/locale, per Tailscale login).
 * Kept here at module level so plain helpers (format.ts) follow it too. Content (ad titles, bank categories,
 * messages to sellers/landlords, AI reasons) is never translated.
 */
export const LANG_OPTIONS = [{ code: 'en', label: 'English' }, { code: 'de', label: 'Deutsch' }]
export const DATE_OPTIONS = ['en-GB', 'de-DE', 'en-US', 'fr-FR']
export const MONEY_OPTIONS = ['de-DE', 'en-IE', 'fr-FR']
const KEY = 'dash:locale'

export const localePrefs = reactive({ lang: 'en', date: 'en-GB', money: 'de-DE' })
try { Object.assign(localePrefs, JSON.parse(localStorage.getItem(KEY) || '{}')) } catch {}

export function rememberPrefs(p: Partial<typeof localePrefs>) {
  Object.assign(localePrefs, p)
  try { localStorage.setItem(KEY, JSON.stringify(localePrefs)) } catch {}
}

/** a date (unix seconds, ms Date or ISO string) in the viewer's date format */
export function fmtDate(t: number | string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (t == null || t === '') return '–'
  const d = t instanceof Date ? t : new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t)
  return isNaN(+d) ? String(t) : d.toLocaleString(localePrefs.date, opts)
}

/** an amount in euros in the viewer's money format */
export const fmtMoney = (n: number | null | undefined, digits = 2) =>
  n == null ? '–' : n.toLocaleString(localePrefs.money, { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits })

/** a plain number in the viewer's money format's grouping */
export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null ? '–' : n.toLocaleString(localePrefs.money, { maximumFractionDigits: digits })
