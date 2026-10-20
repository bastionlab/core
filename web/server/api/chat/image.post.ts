/** one screenshot pasted into the chat (the page has already shrunk it); returns the name to send along */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const data = String(body?.data ?? '')
  if (!data || data.length > 12_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data))
    throw createError({ statusCode: 400, statusMessage: 'image is missing or over 8 MB' })
  sweepChatImages()
  return { name: saveImage(data, String(body?.type ?? ''), CHAT_IMG_DIR) }
})
