import http from 'node:http'
import https from 'node:https'

/** group decides which page a tile shows up on: app = things you actually open, the rest live on their topic page */
export type Group = 'app' | 'media' | 'ai' | 'infra'
/** hue: the tile's accent on the home page, so the apps are told apart by colour and not only by emoji */
export interface Service { name: string, url: string, health: string, healthUrl?: string, ct?: number, icon: string, note?: string, group: Group, hue?: number }

// the web apps on the LAN (addresses from config.json); pve routes the LAN into the tailnet so these links work remotely too
export const services: Service[] = [
  { name: 'Immich', url: `http://${ctIp('immich')}:2283`, health: '/api/server/ping', ct: ctId('immich'), icon: '📷', note: 'Photos', group: 'app', hue: 265 },
  { name: 'Jellyfin', url: `http://${ctIp('jellyfin')}:8096`, health: '/health', ct: ctId('jellyfin'), icon: '🎬', note: 'Movies & series', group: 'app', hue: 285 },
  { name: 'Seerr', url: tsUrl('dl'), health: '', healthUrl: `http://${ctIp('dl')}:5055/api/v1/status`, ct: ctId('dl'), icon: '🍿', note: 'Request movies & shows', group: 'app', hue: 195 },
  { name: 'Audiobookshelf', url: `http://${ctIp('books')}:13378`, health: '/healthcheck', ct: ctId('books'), icon: '🎧', note: 'Audiobooks', group: 'app', hue: 25 },
  { name: 'Open WebUI', url: tsUrl('ai'), health: '', healthUrl: `http://${ctIp('ai')}:8080/health`, ct: ctId('ai'), icon: '🤖', note: 'Local AI chat', group: 'app', hue: 210 },
  { name: 'Ollama', url: `http://${ctIp('ai')}:11434`, health: '/api/version', ct: ctId('ai'), icon: '🦙', note: 'LLM API', group: 'ai' },
  { name: 'Proxmox', url: `https://${cfg().lan.host_ip}:8006`, health: '/', icon: '🖥️', note: 'Hypervisor', group: 'infra' },
  // download stack admin UIs (CT 106). qBittorrent and Prowlarr are published
  // by gluetun, so a red dot on those two also means the VPN tunnel is down.
  { name: 'qBittorrent', url: `http://${ctIp('dl')}:8080`, health: '/', ct: ctId('dl'), icon: '⬇️', note: 'Torrents (via VPN)', group: 'media' },
  { name: 'Prowlarr', url: `http://${ctIp('dl')}:9696`, health: '/ping', ct: ctId('dl'), icon: '🔎', note: 'Indexers (via VPN)', group: 'media' },
  { name: 'Radarr', url: `http://${ctIp('dl')}:7878`, health: '/ping', ct: ctId('dl'), icon: '🎞️', note: 'Movie automation', group: 'media' },
  { name: 'Sonarr', url: `http://${ctIp('dl')}:8989`, health: '/ping', ct: ctId('dl'), icon: '📺', note: 'Series automation', group: 'media' },
  { name: 'Bazarr', url: `http://${ctIp('dl')}:6767`, health: '/', ct: ctId('dl'), icon: '💬', note: 'Subtitles', group: 'media' },
  { name: 'LazyLibrarian', url: `http://${ctIp('dl')}:5299`, health: '/', ct: ctId('dl'), icon: '📚', note: 'Audiobook automation', group: 'media' },
].filter(s => s.ct !== 0) // a CT this install doesn't have (not in config.json) has no tile

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
