export const NOTE_KINDS = [
  { id: 'idea', label: 'Ideas', icon: '💡' },
  { id: 'todo', label: 'Todos', icon: '☑️' },
  { id: 'note', label: 'Notes', icon: '📝' },
  { id: 'link', label: 'Links', icon: '🔗' },
  { id: 'journal', label: 'Journal', icon: '📔' },
] as const
export const kindIcon = (k: string) => NOTE_KINDS.find(x => x.id === k)?.icon ?? '📝'

export const noteImg = (name: string) => `/api/notes/img/${name}`

/** shrink a pasted/dropped image to ≤2000 px JPEG (screenshots stay readable for the model) and upload it */
export async function uploadNoteImage(file: Blob) {
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
  const { name } = await $fetch<{ name: string }>('/api/notes/image', { method: 'POST', body: { data, type: 'image/jpeg' } })
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
