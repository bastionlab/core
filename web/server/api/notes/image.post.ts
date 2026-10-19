/** one pasted/dropped image (the page has already shrunk it); returns the file name to attach to a note */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const data = String(body?.data ?? '')
  if (!data || data.length > 12_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data))
    throw createError({ statusCode: 400, statusMessage: 'image is missing or over 8 MB' })
  return { name: saveImage(data, String(body?.type ?? '')) }
})
