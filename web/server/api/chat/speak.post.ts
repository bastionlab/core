/**
 * Read aloud: one chunk of an answer → speech from Kokoro on the 3060 (container `kokoro` in the ai CT, its
 * OpenAI-style /v1/audio/speech on port 8880). The page splits the answer into sentences and fetches them one after
 * another, so playback starts after the first. Kokoro has no German voice; German text comes out with an accent.
 */
const VOICES = /^[a-z]{2}_[a-z]+$/

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const input = String(body?.text ?? '').trim()
  if (!input || input.length > 2000) throw createError({ statusCode: 400, statusMessage: 'text is missing or too long' })
  if (!ctIp('ai')) throw createError({ statusCode: 503, statusMessage: 'no ai CT in config.json' })
  const voice = VOICES.test(String(body?.voice ?? '')) ? String(body.voice) : 'af_heart'
  const speed = Math.min(1.6, Math.max(0.7, Number(body?.speed) || 1.05))
  const audio = await upstream<ArrayBuffer>('Kokoro', `http://${ctIp('ai')}:8880`, null, '/v1/audio/speech', 60_000, {
    method: 'POST', body: { model: 'kokoro', input, voice, speed, response_format: 'mp3' }, responseType: 'arrayBuffer',
  } as any)
  setResponseHeaders(event, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' })
  return Buffer.from(audio)
})
