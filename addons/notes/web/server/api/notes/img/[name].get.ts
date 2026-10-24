import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name') ?? ''
  if (!imgOk(name) || !existsSync(join(IMG_DIR, name))) throw createError({ statusCode: 404 })
  const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  // names are random and never reused, so the browser can keep them forever
  setResponseHeaders(event, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' })
  return sendStream(event, createReadStream(join(IMG_DIR, name)).on('error', () => {}))
})
