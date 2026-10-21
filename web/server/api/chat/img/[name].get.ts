import { createReadStream } from 'node:fs'
import { join } from 'node:path'

/** chat attachments: screenshots inline, other files as a download under their own name */
export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name') ?? ''
  if (imgOk(name)) {
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    setResponseHeaders(event, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' })
  } else if (chatFileOk(name)) {
    setResponseHeaders(event, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${chatFileLabel(name)}"`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' })
  } else throw createError({ statusCode: 404 })
  return sendStream(event, createReadStream(join(CHAT_IMG_DIR, name)).on('error', () => {}))
})
