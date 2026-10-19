import type { H3Event } from 'h3'

/** agent overview + service health checks — what the dashboard and the AI snapshot both use */
export async function overview(event: H3Event) {
  const [data, health] = await Promise.all([
    agent(event, '/overview'),
    Promise.all(services.map(async s => ({ ...s, ...(await probe(s)) }))),
  ])
  return { ...data, services: health }
}
