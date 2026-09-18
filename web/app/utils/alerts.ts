export interface Alert { level: 'bad' | 'warn', text: string, section: string }

const H = 3600, D = 86400

/** everything that needs attention, derived from /api/overview */
export function alerts(o: any): Alert[] {
  if (!o) return []
  const now = o.time, out: Alert[] = []
  const add = (level: Alert['level'], text: string, section: string) => out.push({ level, text, section })

  for (const s of o.services ?? []) if (!s.up) add('bad', `${s.name} is down${s.error ? ` (${s.error})` : ''}`, 'services')

  for (const p of o.pools ?? []) {
    if (p.health !== 'ONLINE') add('bad', `Pool ${p.name} is ${p.health}`, 'storage')
    if (p.errors && !/No known data errors/.test(p.errors)) add('bad', `Pool ${p.name}: ${p.errors}`, 'storage')
    const cap = pct(p.alloc, p.size)
    if (cap >= 80) add(cap >= 90 ? 'bad' : 'warn', `Pool ${p.name} is ${cap.toFixed(0)}% full`, 'storage')
  }
  for (const d of o.smart ?? []) if (d.passed === false) add('bad', `SMART failing on ${d.dev} (${d.model})`, 'storage')

  const b = o.backups
  if (b) {
    for (const v of b.vzdump) {
      if (!v.time) add('warn', `CT ${v.vmid} ${v.name} has no vzdump backup yet`, 'backups')
      else if (now - v.time > 26 * H) add('bad', `CT ${v.vmid} ${v.name}: last backup ${ago(v.time, now)}`, 'backups')
    }
    if (b.sanoid.result !== 'success') add('bad', `sanoid last run: ${b.sanoid.result}`, 'backups')
    if (b.syncoid.result !== 'success') add('bad', `syncoid last run: ${b.syncoid.result}`, 'backups')
    if (b.syncoid.last && now - b.syncoid.last > 26 * H) add('bad', `syncoid last ran ${ago(b.syncoid.last, now)}`, 'backups')
    for (const d of b.sanoid.datasets) if (now - d.time > 26 * H) add('warn', `No snapshot of ${d.name} for ${duration(now - d.time)}`, 'backups')
  }

  const g = o.gpu
  if (g && pct(g.memUsed, g.memTotal) > 90) add('warn', `GPU memory ${pct(g.memUsed, g.memTotal).toFixed(0)}% used`, 'host')
  if (o.host?.temps?.cpu > 85) add('warn', `CPU at ${o.host.temps.cpu}°C`, 'host')

  const key = o.tailnet?.authKey
  if (key && key.expires - now < 14 * D) add(key.expires < now ? 'bad' : 'warn', `Tailscale auth key for newdev ${key.expires < now ? 'expired' : 'expires ' + ago(key.expires, now)}`, 'tailnet')
  for (const n of o.tailnet?.nodes ?? []) if (n.keyExpiry && Date.parse(n.keyExpiry) / 1000 - now < 14 * D) add('warn', `Tailscale key of ${n.name} expires ${ago(n.keyExpiry, now)}`, 'tailnet')

  for (const c of o.cts ?? []) if (c.status !== 'running' && !c.tags.includes('dev')) add('warn', `CT ${c.vmid} ${c.name} is ${c.status}`, 'containers')

  for (const [where, list] of Object.entries(o.ports?.cts ?? {}) as [string, any][])
    for (const s of list.serve) if (s.public) add('warn', `${s.url} is public (Funnel) on CT ${where}`, 'ports')

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1))
}
