export const NOTE_KINDS = [
  { id: 'idea', label: 'Ideas', icon: 'lightbulb' },
  { id: 'todo', label: 'Todos', icon: 'list-checks' },
  { id: 'note', label: 'Notes', icon: 'note' },
  { id: 'link', label: 'Links', icon: 'link' },
  { id: 'journal', label: 'Journal', icon: 'book' },
] as const
/** <Icon> name for a note kind */
export const kindIcon = (k: string) => NOTE_KINDS.find(x => x.id === k)?.icon ?? 'note'

export const noteImg = (name: string) => `/api/notes/img/${name}`

/** shrink a pasted/dropped image to ≤2000 px JPEG (screenshots stay readable for the model) and upload it */
export async function uploadNoteImage(file: Blob, url = '/api/notes/image') {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  const g = c.getContext('2d')!
  g.fillStyle = '#fff' // transparent PNGs would turn black in a JPEG
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const blob: Blob = await new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('could not encode image'))), 'image/jpeg', 0.86))
  const data = await new Promise<string>((ok) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(blob)
  })
  const { name } = await $fetch<{ name: string }>(url, { method: 'POST', body: { data, type: 'image/jpeg' } })
  return name
}

/** any other file for the Claude chat, sent as it is (max 20 MB) */
export async function uploadChatFile(file: File) {
  if (file.size > 20 * 2 ** 20) throw new Error('over 20 MB')
  const data = await new Promise<string>((ok, no) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.onerror = () => no(new Error('could not read file'))
    r.readAsDataURL(file)
  })
  const { name } = await $fetch<{ name: string }>('/api/chat/file', { method: 'POST', body: { data, name: file.name || 'file' } })
  return name
}

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm

/** "- [ ]" items: done / total */
export function taskCount(body: string) {
  let done = 0, total = 0
  for (const m of body.matchAll(TASK)) { total++; if (m[2] !== ' ') done++ }
  return { done, total }
}

/** flip the i-th checkbox in the markdown source */
export function toggleTask(body: string, i: number) {
  let n = 0
  return body.replace(TASK, (all, a, x, b) => (n++ === i ? `${a}${x === ' ' ? 'x' : ' '}${b}` : all))
}

/** markdown → html with clickable checkboxes (marked renders them disabled, in source order) */
export function noteHtml(body: string) {
  let n = 0
  return md(body).replace(/<input (checked="" )?disabled="" type="checkbox">/g, (_, c) => `<input type="checkbox" data-task="${n++}"${c ? ' checked' : ''}>`)
}
