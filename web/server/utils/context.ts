import type { H3Event } from 'h3'

export type Scope = 'home' | 'media' | 'dev' | 'metrics' | 'chat' | 'notes'
export const SCOPES: Scope[] = ['home', 'media', 'dev', 'metrics', 'chat', 'notes']

/** what the model is told about, for the page the question was asked from */
export async function scopeContext(event: H3Event, scope: Scope, models: any[] | null) {
  if (scope === 'media') {
    const [media, o] = await Promise.all([mediaData(event), overview(event)])
    return `${mediaSnapshot(media)}\n${PLACES_MEDIA}\n${homeSnapshot(o)}`
  }
  if (scope === 'dev') {
    const [boxes, o, gh] = await Promise.all([
      agent<any[]>(event, '/projects').catch(() => []),
      overview(event),
      agent<any>(event, '/github/repos').catch(() => null),
    ])
    const devCts = (o.cts ?? []).filter((c: any) => c.tags?.includes('dev'))
    const repos = gh?.repos?.length
      ? `\n\n## GitHub (${gh.user}, ${gh.scope})\n`
        + gh.repos.slice(0, 40).map((r: any) => `${r.full}${r.private ? ' (private)' : ''}${r.lang ? ` · ${r.lang}` : ''}${r.desc ? ` — ${r.desc}` : ''}`).join('\n')
        + '\nA repo that is not listed as a project below is not cloned onto a dev box yet — propose project_new to clone it.'
      : ''

    return `${devSnapshot(boxes)}\n\n## Dev containers\n`
      + devCts.map((c: any) => `CT ${c.vmid} ${c.name} ${c.status}, ${c.cpus} cores, ram ${Math.round((c.mem ?? 0) / 2 ** 20)} MB used`).join('\n')
      + repos
      + `\n\nNew dev boxes are created with the newdev action (ids ${cfg().devbox.ids.join('-')}, ips ${cfg().devbox.ips.join(' to ')}).\n${PLACES_DEV}`
  }
  if (scope === 'notes') return notesSnapshot()
  const o = await overview(event)
  if (scope === 'home') return `${homeSnapshot(o)}\n${PLACES_HOST}`
  return `${snapshot(o, models)}\n${PLACES_HOST}`
}

/** the same payload /api/media serves */
export async function mediaData(event: H3Event) {
  const [data, health] = await Promise.all([
    agent(event, '/media'),
    Promise.all(services().filter(s => s.group === 'media' || s.name === 'Seerr').map(async s => ({ ...s, ...(await probe(s)) }))),
  ])
  return { ...(data as any), services: health }
}
