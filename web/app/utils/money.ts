// shared bits of the /money page and its components
export const fmtEur = (n?: number | null, frac = 2) =>
  n == null ? '–' : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: frac, maximumFractionDigits: frac })
export const fmtSigned = (n: number, frac = 0) => `${n >= 0 ? '+' : '−'}${fmtEur(Math.abs(n), frac)}`
export const fmtPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`

/** local YYYY-MM-DD (toISOString would be UTC and flip the day around midnight) */
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const isoMonth = (d = new Date()) => isoDay(d).slice(0, 7)
export const monthTitle = (m: string) => new Date(m + '-01T12:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

/** 'Heute' / 'Gestern' / 'Mo., 14. Okt.' (+ year when not this year) */
export function dayTitle(day: string) {
  const today = isoDay()
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (day === today) return 'Heute'
  if (day === isoDay(y)) return 'Gestern'
  const d = new Date(day + 'T12:00')
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) })
}

export const PERIODS: Record<string, { label: string, per: string, days: number, perMonth: number }> = {
  weekly: { label: 'wöchentlich', per: 'Woche', days: 7, perMonth: 4.33 },
  monthly: { label: 'monatlich', per: 'Monat', days: 30.4, perMonth: 1 },
  quarterly: { label: 'vierteljährlich', per: 'Quartal', days: 91, perMonth: 1 / 3 },
  yearly: { label: 'jährlich', per: 'Jahr', days: 365, perMonth: 1 / 12 },
}

/** charge dates of an active subscription from its next_date onward, up to `until` (YYYY-MM-DD) */
export function subCharges(s: any, until: string) {
  const out: string[] = []
  if (s.state !== 'active' || !s.next_date) return out
  const p = PERIODS[s.period]
  if (!p) return out
  const d = new Date(s.next_date + 'T12:00')
  for (let i = 0; i < 60 && isoDay(d) <= until; i++) {
    out.push(isoDay(d))
    if (s.period === 'monthly') d.setMonth(d.getMonth() + 1)
    else if (s.period === 'quarterly') d.setMonth(d.getMonth() + 3)
    else if (s.period === 'yearly') d.setFullYear(d.getFullYear() + 1)
    else d.setDate(d.getDate() + 7)
  }
  return out
}
export const subName = (s: any) => s.name || s.payee
