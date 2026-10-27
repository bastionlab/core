/**
 * Read an answer aloud with Kokoro on the 3060 (/api/chat/speak). A long answer is first boiled down to a few spoken
 * sentences by the local model (/api/chat/gist, streamed: each sentence is spoken as soon as it is written); `full`
 * reads every word. The text is cut into chunks fetched one ahead of playback; the first is a single sentence, so
 * Kokoro has it ready in a fraction of a second. One answer at a time, on any page;
 * `speaking` is the key of the one playing (tap again = stop).
 */
const strip = (md: string) => md
  .replace(/```questions[\s\S]*?```/g, '')
  .replace(/```[\s\S]*?```/g, ' (code) ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/^\s*[-*+]\s+/gm, '')
  .replace(/^\s*#+\s*/gm, '')
  .replace(/[*_~>|]+/g, '')
  .replace(/\s+/g, ' ')
  .trim()

function chunks(md: string, max = 280) {
  const out: string[] = []
  let cur = ''
  for (const s of strip(md).split(/(?<=[.!?:;])\s+/)) {
    if (cur && (!out.length || (cur + ' ' + s).length > max)) { out.push(cur); cur = '' }
    cur = cur ? `${cur} ${s}` : s
    while (cur.length > max * 1.5) { out.push(cur.slice(0, max)); cur = cur.slice(max) }
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** the spoken summary, sentence by sentence as the local model writes it; [] if it failed before saying anything */
async function* gist(md: string): AsyncGenerator<string> {
  let said = false
  try {
    const res = await fetch('/api/chat/gist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: md }) })
    if (!res.ok || !res.body) return
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      const ss = buf.split(/(?<=[.!?])\s+/)
      buf = ss.pop()!
      for (const s of ss) { const t = strip(s); if (t) { said = true; yield t } }
    }
    const t = strip(buf)
    if (t) { said = true; yield t }
  } catch (e) { if (said) throw e }
}

const LONG = 450 // characters of plain text: above this, read a summary
let audio: HTMLAudioElement | null = null
let gen = 0

export function useSpeak() {
  const speaking = useState('speak:key', () => '')
  const loading = useState('speak:loading', () => false)
  const error = useState('speak:error', () => '')

  function stop() {
    gen++
    audio?.pause()
    speaking.value = ''
    loading.value = false
  }

  async function speak(key: string, md: string, full = false) {
    if (speaking.value === key) return stop()
    stop()
    const my = ++gen
    speaking.value = key
    error.value = ''
    // unlock playback inside the tap: the summary takes a moment, and phones refuse play() once the gesture is old
    audio ??= new Audio()
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
    audio.play().catch(() => {})
    loading.value = true
    const long = !full && strip(md).length > LONG
    async function* source() {
      let any = false
      if (long) for await (const t of gist(md)) { any = true; yield t }
      if (!any) yield* chunks(md)
    }
    const it = source()
    const get = (s: string) => $fetch<Blob>('/api/chat/speak', { method: 'POST', body: { text: s }, responseType: 'blob' })
    // the next chunk's text and audio are fetched while this one plays
    const fetchNext = async () => { const n = await it.next(); return n.done ? null : await get(n.value) }
    let next = fetchNext()
    next.catch(() => {}) // a prefetch failing after Stop isn't an error
    try {
      while (my === gen) {
        const blob = await next
        if (!blob || my !== gen) return
        next = fetchNext()
        next.catch(() => {})
        loading.value = false
        const url = URL.createObjectURL(blob)
        audio.src = url
        await audio.play()
        await new Promise<void>((res) => { audio!.onended = audio!.onpause = () => res() })
        URL.revokeObjectURL(url)
      }
    } catch (e: any) {
      if (my === gen) error.value = e?.data?.statusMessage || e?.message || 'read aloud failed'
    } finally {
      if (my === gen) { speaking.value = ''; loading.value = false }
    }
  }

  return { speak, stop, speaking, loading, error }
}
