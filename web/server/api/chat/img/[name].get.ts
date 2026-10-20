import { createReadStream } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name') ?? ''
  if (!imgOk(name)) throw createError({ statusCode: 404 })
  const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  setResponseHeaders(event, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' })
  return sendStream(event, createReadStream(join(CHAT_IMG_DIR, name)).on('error', () => {}))
})
