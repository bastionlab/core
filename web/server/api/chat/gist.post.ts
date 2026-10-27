/**
 * Read aloud, long answers: the local model (the warm one on the 3060, free) turns the answer into a few spoken
 * sentences — the point and what to do — instead of reading every list item and path. Short answers are read as
 * they are (useSpeak decides). Streams plain text, so the page can speak the first sentence while the rest is written.
 * No num_ctx and keep_alive -1: the same settings the warm-model timer pins it with, or Ollama reloads it (seconds).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const text = String(body?.text ?? '').trim().slice(0, 24_000)
  if (!text) throw createError({ statusCode: 400, statusMessage: 'nothing to summarise' })
  const models = (await aiModels(event)).filter((m: any) => !m.uncensored)
  const model = (models.find((m: any) => m.warm) ?? models.find((m: any) => m.loaded) ?? models.at(-1))?.name
  if (!model) throw createError({ statusCode: 503, statusMessage: 'no local model' })
  const stream = await upstream<ReadableStream<Uint8Array>>('ollama', useRuntimeConfig(event).ollamaUrl, null, '/api/chat', 90_000, {
    method: 'POST',
    responseType: 'stream',
    body: {
      model, stream: true, think: false, keep_alive: -1, options: { temperature: 0.3 },
      messages: [
        { role: 'system', content: 'You turn a written chat answer into a short spoken summary for someone listening on their phone. 2 to 4 plain sentences, at most 70 words: the main point first, then what (if anything) they need to do. No lists, no markdown, no file paths, URLs, code or numbers nobody can follow by ear. Same language as the answer. Output only the summary.' },
        { role: 'user', content: text },
      ],
    },
  } as any)
  // Ollama's NDJSON → just the words
  const dec = new TextDecoder()
  let buf = ''
  const words = stream.pipeThrough(new TransformStream<Uint8Array, string>({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        try { const c = line && JSON.parse(line).message?.content; if (c) ctl.enqueue(c) } catch {}
      }
    },
  })).pipeThrough(new TextEncoderStream())
  setResponseHeaders(event, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
  return sendStream(event, words)
})
