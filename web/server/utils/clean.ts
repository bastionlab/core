/** Rebuilding a browser body field by field, for the proxies to CT 107 / 108: nothing is forwarded unchecked. */
export const cleanStr = (v: any, max = 120) => String(v ?? '').trim().slice(0, max)
/** a number or null; `''`, null and garbage are all "not set" */
export const cleanNum = (v: any) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
export const cleanInt = (v: any) => { const n = cleanNum(v); return n == null ? null : Math.round(n) }
/** an array or a comma-separated string → trimmed, non-empty, capped */
export const cleanList = (v: any, max = 30, len = 60) => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((x: any) => cleanStr(x, len)).filter(Boolean).slice(0, max)
export const cleanPick = <T extends string>(v: any, ok: readonly T[], dflt: T): T => (ok.includes(v) ? v : dflt)
