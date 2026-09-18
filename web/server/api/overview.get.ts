export default defineEventHandler(async (event) => {
  const [data, health] = await Promise.all([
    agent(event, '/overview'),
    Promise.all(services.map(async s => ({ ...s, ...(await check(s.url + s.health)) }))),
  ])
  return { ...data, services: health }
})
