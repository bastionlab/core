/**
 * Voice input for the chat: a recording from the browser → Whisper on the 3060 (subgen in the ai CT, which also
 * makes the Jellyfin subtitles; its OpenAI-style endpoint on port 9000) → the text.
 * The model loads on the first call (a few seconds) and frees the VRAM again a minute after.
 * Then the warm local model tidies it: fillers, false starts and "wait no" corrections go, the final intent stays.
 * Any failure there falls back to the raw transcript (also returned as `raw`).
 */
const HINT = 'Homelab, Proxmox, pve, Jellyfin, Claude, Bastion, Dashboard, Ollama, Tailscale, ZFS.'
const CLEAN = 'You clean up voice transcripts. Remove filler words, false starts, repetitions and self-corrections '
  + '(e.g. "do X, wait no, do Y" becomes "do Y"), keeping only what the speaker finally meant. Fix punctuation. '
  + 'Do not answer, summarise or add anything, keep the wording and language otherwise. Output only the cleaned text.'

async function tidy(event: any, raw: string) {
  if (raw.split(/\s+/).length < 4) return raw
  try {
    const model = (await aiModels(event)).find((m: any) => m.warm)?.name
    if (!model) return raw
    const r: any = await ollama(event, '/api/chat', { method: 'POST', body: {
      model, stream: false, think: false, keep_alive: -1, options: { temperature: 0.1 },
      messages: [{ role: 'system', content: CLEAN }, { role: 'user', content: raw }],
    } })
    const out = String(r?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^"(.*)"$/s, '$1')
    // a reply far longer than the input is the model answering instead of cleaning
    return out && out.length < raw.length * 1.3 + 20 ? out : raw
  } catch { return raw }
}

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const audio = parts?.find(p => p.name === 'audio')
  if (!audio?.data?.length || audio.data.length > 25_000_000)
    throw createError({ statusCode: 400, statusMessage: 'recording is missing or over 25 MB' })
  if (!ctIp('ai')) throw createError({ statusCode: 503, statusMessage: 'no ai CT in config.json' })
  const form = new FormData()
  const ext = /mp4|m4a|aac/.test(audio.type ?? '') ? 'mp4' : /ogg/.test(audio.type ?? '') ? 'ogg' : 'webm'
  form.append('file', new Blob([audio.data], { type: audio.type || 'audio/webm' }), `voice.${ext}`)
  form.append('model', 'whisper-1')
  form.append('prompt', HINT)
  const r: any = await upstream('Whisper', `http://${ctIp('ai')}:9000`, null, '/v1/audio/transcriptions', 180_000, { method: 'POST', body: form })
  if (r?.error) throw createError({ statusCode: 502, statusMessage: `Whisper: ${r.error}` })
  const raw = String(r?.text ?? '').replace(/\s*\n\s*/g, ' ').trim()
  return { text: await tidy(event, raw), raw }
})
