import http from 'node:http'
import https from 'node:https'

/** group decides which page a tile shows up on: app = things you actually open, the rest live on their topic page */
export type Group = 'app' | 'media' | 'ai' | 'infra'
/** hue: the tile's accent on the home page, so the apps are told apart by colour and not only by emoji */
export interface Service { name: string, url: string, health: string, healthUrl?: string, ct?: number, icon: string, note?: string, group: Group, hue?: number }

// the core's own apps (they don't belong to any add-on); pve routes the LAN into the tailnet so these links work
// remotely too. Add-ons bring theirs in addon.yaml `apps:` (Seerr and the *arr → Media, Open WebUI → Local AI).
const CORE: Service[] = [
  { name: 'Immich', url: `http://${ctIp('immich')}:2283`, health: '/api/server/ping', ct: ctId('immich'), icon: '📷', note: 'Photos', group: 'app', hue: 265 },
  { name: 'Jellyfin', url: `http://${ctIp('jellyfin')}:8096`, health: '/health', ct: ctId('jellyfin'), icon: '🎬', note: 'Movies & series', group: 'app', hue: 285 },
  { name: 'Audiobookshelf', url: `http://${ctIp('books')}:13378`, health: '/healthcheck', ct: ctId('books'), icon: '🎧', note: 'Audiobooks', group: 'app', hue: 25 },
  { name: 'Proxmox', url: `https://${cfg().lan.host_ip}:8006`, health: '/', icon: '🖥️', note: 'Hypervisor', group: 'infra' },
].filter(s => s.ct !== 0) // a CT this install doesn't have (not in config.json) has no tile

/** an addon.yaml app → a Service: `ts: true` links the CT's tailnet name, health is checked on the LAN port */
function fromAddon(a: any): Service {
  const lan = `http://${ctIp(a.ct)}:${a.port}`
  const health = a.health ?? '/'
  return {
    name: String(a.name), icon: String(a.icon ?? '🧩'), note: a.note, group: (a.group ?? 'app') as Group, hue: a.hue, ct: ctId(a.ct),
    ...(a.ts ? { url: tsUrl(a.ct), health: '', healthUrl: lan + health } : { url: lan, health }),
  }
}

/** every app tile right now: the core's plus those of add-ons that are installed and switched on */
export function services(): Service[] {
  const off = new Set(addonsOff())
  const extra = (useRuntimeConfig().addonApps as any[] ?? []).filter(a => !off.has(a.addon) && ctId(a.ct)).map(fromAddon)
  return [...CORE, ...extra]
}

export function check(url: string, timeout = 3000): Promise<{ up: boolean, status?: number, ms?: number, error?: string }> {
  const t0 = performance.now()
  const lib = url.startsWith('https') ? https : http
  return new Promise((resolve) => {
    const req = lib.get(url, { timeout, rejectUnauthorized: false }, (res) => {
      res.resume()
      const status = res.statusCode ?? 0
      resolve({ up: status > 0 && status < 500, status, ms: Math.round(performance.now() - t0) })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', e => resolve({ up: false, error: e.message }))
  })
}

type Health = Awaited<ReturnType<typeof check>>
const GRACE = 3000
const seen = new Map<string, { good?: Health, failSince?: number, at: number }>()

/** check(), but a service only counts as down once it has failed for GRACE ms — a restart or a slow
 *  moment shows the last good result instead of flashing red. Kept per URL in this server process. */
export async function probe(s: Service): Promise<Health> {
  const url = s.healthUrl ?? s.url + s.health
  const r = await check(url)
  const now = Date.now()
  const prev = seen.get(url)
  // nobody looked for a minute: an old failure says nothing about this one
  const st = prev && now - prev.at < 60_000 ? prev : { good: prev?.good, at: now }
  st.at = now
  if (r.up) { st.good = r; st.failSince = undefined; seen.set(url, st); return r }
  st.failSince ??= now
  seen.set(url, st)
  return now - st.failSince < GRACE && st.good ? st.good : r
}
