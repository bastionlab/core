// Files in a chat answer: a link to /files?p=<folder>/<name>.<ext> (the Files add-on) gets a card after its paragraph with an
// inline preview (video / audio / image), Open (the Files page, in-app) and Download. Works on the HTML that linkify() made.
const MAX = 6
const EXT: Record<string, 'video' | 'audio' | 'image'> = {
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', opus: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const A = /<a\s[^>]*?href="(\/files\?[^"]*)"[^>]*>[\s\S]*?<\/a>/g

/** html (already linkified) → html with a card after the paragraph of each file link; `open` = label of the Open link, `dl` of Download */
export function fileCards(html: string, label: { open: string, dl: string }) {
  if (!html.includes('/files?')) return html
  const seen = new Set<string>()
  const adds: { at: number, card: string }[] = []
  let m: RegExpExecArray | null
  A.lastIndex = 0
  while ((m = A.exec(html)) && adds.length < MAX) {
    let q: URLSearchParams
    try { q = new URLSearchParams(unesc(m[1]!).split('?')[1] ?? '') } catch { continue }
    const p = q.get('p') ?? '', root = q.get('r') || q.get('root') || 'files'
    const name = p.split('/').pop() ?? ''
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase()
    if (!ext || p.split('/').includes('..') || seen.has(root + '\0' + p)) continue
    seen.add(root + '\0' + p)
    const raw = `/api/files/raw?root=${encodeURIComponent(root)}&p=${encodeURIComponent(p)}`
    const kind = EXT[ext]
    const media = kind === 'video' ? `<video controls preload="metadata" playsinline src="${esc(raw)}"></video>`
      : kind === 'audio' ? `<audio controls preload="metadata" src="${esc(raw)}"></audio>`
      : kind === 'image' ? `<img loading="lazy" alt="${esc(name)}" src="${esc(raw)}">` : ''
    const page = `/files?${root === 'files' ? '' : `r=${encodeURIComponent(root)}&`}p=${encodeURIComponent(p).replace(/%2F/gi, '/')}`
    const card = `<div class="fcard"><div class="fch"><b>${esc(name)}</b><span>${esc(ext.toUpperCase())}</span></div>${media}`
      + `<div class="fca"><a class="in" href="${esc(page)}">${esc(label.open)}</a><a href="${esc(raw)}&amp;dl=1" download="${esc(name)}">${esc(label.dl)}</a></div></div>`
    const end = m.index + m[0].length
    const close = /<\/(?:p|li)>/.exec(html.slice(end))
    adds.push({ at: close ? end + close.index + close[0].length : end, card })
  }
  let out = html
  for (const { at, card } of adds.sort((a, b) => b.at - a.at)) out = out.slice(0, at) + card + out.slice(at)
  return out
}
