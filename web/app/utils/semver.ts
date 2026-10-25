/** the same version ranges as agent/semver.py (addon.yaml `core:` — ">=0.2.0 <1.0.0", "^0.2.0", "0.3") */
const parse = (v: string) => {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(String(v ?? '').trim())
  if (!m) return null
  return [+m[1]!, +(m[2] ?? 0), +(m[3] ?? 0), m[4] ? 0 : 1, m[4] ?? ''] as const
}
const cmp = (a: readonly any[], b: readonly any[]) => {
  for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}
export function coreSatisfies(version: string, spec?: string) {
  if (!spec || spec === '*' || !version) return true
  const v = parse(version)
  if (!v) return true
  return spec.trim().split(/\s+/).every((part) => {
    if (part.startsWith('^')) {
      const lo = parse(part.slice(1))
      if (!lo) return false
      const hi = lo[0] ? [lo[0] + 1, 0, 0, 0, ''] : [0, lo[1] + 1, 0, 0, '']
      return cmp(v, lo) >= 0 && cmp(v, hi) < 0
    }
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(part)!
    const w = parse(m[2]!)
    if (!w) return false
    const c = cmp(v, w)
    return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': cmp(v.slice(0, 3), w.slice(0, 3)) === 0 }[m[1] ?? '=']!
  })
}
