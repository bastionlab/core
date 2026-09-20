import type { H3Event } from 'h3'

export type Scope = 'home' | 'media' | 'dev' | 'metrics' | 'chat'
export const SCOPES: Scope[] = ['home', 'media', 'dev', 'metrics', 'chat']

/** what the model is told about, for the page the question was asked from */
export async function scopeContext(event: H3Event, scope: Scope, models: any[] | null) {
  if (scope === 'media') {
    const [media, o] = await Promise.all([mediaData(event), overview(event)])
    return `${mediaSnapshot(media)}\n\n${homeSnapshot(o)}`
  }
  if (scope === 'dev') {
    const [boxes, o] = await Promise.all([agent<any[]>(event, '/projects').catch(() => []), overview(event)])
    const devCts = (o.cts ?? []).filter((c: any) => c.tags?.includes('dev'))
    return `${devSnapshot(boxes)}\n\n## Dev containers\n`
      + devCts.map((c: any) => `CT ${c.vmid} ${c.name} ${c.status}, ${c.cpus} cores, ram ${Math.round((c.mem ?? 0) / 2 ** 20)} MB used`).join('\n')
      + `\n\nNew dev boxes are created with the newdev action (ids 200-299, ips 192.168.1.60-99).`
  }
  const o = await overview(event)
  if (scope === 'home') return homeSnapshot(o)
  return snapshot(o, models)
}

/** the same payload /api/media serves */
export async function mediaData(event: H3Event) {
  const [data, health] = await Promise.all([
    agent(event, '/media'),
    Promise.all(services.filter(s => s.group === 'media' || s.name === 'Seerr').map(async s => ({ ...s, ...(await check(s.healthUrl ?? s.url + s.health)) }))),
  ])
  return { ...(data as any), services: health }
}
