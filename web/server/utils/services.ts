import http from 'node:http'
import https from 'node:https'

export interface Service { name: string, url: string, health: string, ct?: number, icon: string, note?: string }

// the web apps on the LAN; pve routes 192.168.1.0/24 into the tailnet so these links work remotely too
export const services: Service[] = [
  { name: 'Immich', url: 'http://192.168.1.51:2283', health: '/api/server/ping', ct: 101, icon: '📷', note: 'Photos' },
  { name: 'Jellyfin', url: 'http://192.168.1.52:8096', health: '/health', ct: 102, icon: '🎬', note: 'Movies & series' },
  { name: 'Navidrome', url: 'http://192.168.1.53:4533', health: '/ping', ct: 103, icon: '🎵', note: 'Music' },
  { name: 'Audiobookshelf', url: 'http://192.168.1.53:13378', health: '/healthcheck', ct: 103, icon: '🎧', note: 'Audiobooks' },
  { name: 'Proxmox', url: 'https://192.168.1.50:8006', health: '/', icon: '🖥️', note: 'Hypervisor' },
]

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
