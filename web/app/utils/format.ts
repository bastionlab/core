export function bytes(n?: number | null, digits = 1) {
  if (n == null) return '–'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i && n < 100 ? digits : 0)} ${u[i]}`
}

export const pct = (a?: number | null, b?: number | null) => (a != null && b ? (100 * a) / b : 0)

export function duration(sec?: number | null) {
  if (sec == null) return '–'
  sec = Math.abs(sec)
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${Math.floor(sec)}s`
}

/** "3h ago" / "in 2h" from a unix timestamp (s) */
export function ago(ts?: number | string | null, now = Date.now() / 1000) {
  if (ts == null) return 'never'
  const t = typeof ts === 'string' ? Date.parse(ts) / 1000 : ts
  const d = now - t
  return d >= 0 ? `${duration(d)} ago` : `in ${duration(-d)}`
}

/** the hunter pages used to be German; same as ago() now */
export const vor = (ts?: number | null, now = Date.now() / 1000) => ago(ts, now)

/** the readable part of a failed $fetch: our own createError text first (statusMessage on the error itself is
 *  taken from the HTTP status line, which HTTP/2 doesn't carry) */
export const errText = (e: any, fallback = 'failed') => e?.data?.statusMessage || e?.data?.message || e?.statusMessage || e?.message || fallback

export const clock = (ts?: number | null) =>
  ts == null ? '–' : new Date(ts * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/** tone for a 0–100 usage value */
export const tone = (v: number, warn = 75, bad = 90) => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok')

