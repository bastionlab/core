import { readFileSync } from 'node:fs'

/** this install's own values, from /etc/dash/config.json (deploy.sh copies it in from pve); see config.example.json */
export interface DashConfig {
  name: string, tailnet: string, owner_logins: string[]
  lan: { subnet: string, host_ip: string }
  paths: { dashboard: string, devbox: string }
  devbox: { ids: [number, number], ips: [string, string] }
  cts: Record<string, { id: number, ip: string }>
  /** index: URL of the bastionlab/addons index.json; counter: the install-count Worker; share_installs: opt-in pings */
  /** optional: http://<host>:11435, the Ollama logging proxy (add-on cost); unset = callers use Ollama directly */
  ollama_proxy?: string
  marketplace?: { index?: string, counter?: string, share_installs?: boolean }
}

let cached: DashConfig | null = null
export function cfg(): DashConfig {
  return (cached ??= JSON.parse(readFileSync('/etc/dash/config.json', 'utf8')))
}
export const ctIp = (name: string) => cfg().cts[name]?.ip ?? ''
export const ctId = (name: string) => cfg().cts[name]?.id ?? 0
/** https://<sub>.<tailnet> — the apps published with tailscale serve */
export const tsUrl = (sub: string) => `https://${sub}.${cfg().tailnet}`

/** the part the browser may see: links and addresses, no secrets */
export function publicCfg() {
  const c = cfg()
  return { name: c.name, tailnet: c.tailnet, hostIp: c.lan.host_ip, cts: c.cts }
}
