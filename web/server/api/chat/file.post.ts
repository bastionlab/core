/** one non-image file dropped into the chat (pdf, text, zip, …); returns the name to send along */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const data = String(body?.data ?? '')
  if (!data || data.length > 28_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data))
    throw createError({ statusCode: 400, statusMessage: 'file is missing or over 20 MB' })
  sweepChatImages()
  return { name: saveChatFile(data, String(body?.name ?? 'file')) }
})
