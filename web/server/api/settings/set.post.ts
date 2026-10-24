/** one add-on field from /settings; the agent checks it against the add-on's addon.yaml again */
export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  const addon = String(b?.addon ?? '').slice(0, 40)
  const r = await agent(event, '/settings/set', { method: 'POST', body: { addon, key: String(b?.key ?? '').slice(0, 60), value: b?.value } })
  forgetAddonSettings(addon)
  return r
})
