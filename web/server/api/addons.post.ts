/** switch one add-on on or off; dependencies are checked both ways */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return { off: setAddon(String(body?.id ?? ''), body?.on === true) }
})
