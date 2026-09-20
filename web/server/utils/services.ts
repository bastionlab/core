import http from 'node:http'
import https from 'node:https'

/** group decides which page a tile shows up on: app = things you actually open, the rest live on their topic page */
export type Group = 'app' | 'media' | 'ai' | 'infra'
export interface Service { name: string, url: string, health: string, healthUrl?: string, ct?: number, icon: string, note?: string, group: Group }

// the web apps on the LAN; pve routes 192.168.1.0/24 into the tailnet so these links work remotely too
export const services: Service[] = [
  { name: 'Immich', url: 'http://192.168.1.51:2283', health: '/api/server/ping', ct: 101, icon: '📷', note: 'Photos', group: 'app' },
  { name: 'Jellyfin', url: 'http://192.168.1.52:8096', health: '/health', ct: 102, icon: '🎬', note: 'Movies & series', group: 'app' },
  { name: 'Seerr', url: 'https://dl.example-tailnet.ts.net', health: '', healthUrl: 'http://192.168.1.56:5055/api/v1/status', ct: 106, icon: '🍿', note: 'Request movies & shows', group: 'app' },
  { name: 'Navidrome', url: 'http://192.168.1.53:4533', health: '/ping', ct: 103, icon: '🎵', note: 'Music', group: 'app' },
  { name: 'Audiobookshelf', url: 'http://192.168.1.53:13378', health: '/healthcheck', ct: 103, icon: '🎧', note: 'Audiobooks', group: 'app' },
  { name: 'Open WebUI', url: 'https://ai.example-tailnet.ts.net', health: '', healthUrl: 'http://192.168.1.55:8080/health', ct: 105, icon: '🤖', note: 'Local AI chat', group: 'app' },
  { name: 'Ollama', url: 'http://192.168.1.55:11434', health: '/api/version', ct: 105, icon: '🦙', note: 'LLM API', group: 'ai' },
  { name: 'Proxmox', url: 'https://192.168.1.50:8006', health: '/', icon: '🖥️', note: 'Hypervisor', group: 'infra' },
  // download stack admin UIs (CT 106). qBittorrent and Prowlarr are published
  // by gluetun, so a red dot on those two also means the VPN tunnel is down.
  { name: 'qBittorrent', url: 'http://192.168.1.56:8080', health: '/', ct: 106, icon: '⬇️', note: 'Torrents (via VPN)', group: 'media' },
  { name: 'Prowlarr', url: 'http://192.168.1.56:9696', health: '/ping', ct: 106, icon: '🔎', note: 'Indexers (via VPN)', group: 'media' },
  { name: 'Radarr', url: 'http://192.168.1.56:7878', health: '/ping', ct: 106, icon: '🎞️', note: 'Movie automation', group: 'media' },
  { name: 'Sonarr', url: 'http://192.168.1.56:8989', health: '/ping', ct: 106, icon: '📺', note: 'Series automation', group: 'media' },
  { name: 'Bazarr', url: 'http://192.168.1.56:6767', health: '/', ct: 106, icon: '💬', note: 'Subtitles', group: 'media' },
  { name: 'Lidarr', url: 'http://192.168.1.56:8686', health: '/ping', ct: 106, icon: '🎶', note: 'Music automation', group: 'media' },
  { name: 'LazyLibrarian', url: 'http://192.168.1.56:5299', health: '/', ct: 106, icon: '📚', note: 'Audiobook automation', group: 'media' },
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
