export interface QOption { label: string, description?: string }
export interface Question { header?: string, q: string, multi?: boolean, options: QOption[] }

const FENCE = /```questions[^\n]*\n([\s\S]*?)```/

/**
 * Claude ends an answer with a ```questions block when the owner should decide something (the dashboard's stand-in
 * for AskUserQuestion). Returns the prose without the block plus the parsed questions; while the answer is still
 * streaming, a half-written block is hidden instead of flashing up as raw JSON.
 */
export function splitQuestions(a: string, streaming = false): { text: string, qs: Question[] | null } {
  const m = FENCE.exec(a)
  if (!m) {
    const open = a.indexOf('```questions')
    return { text: streaming && open >= 0 ? a.slice(0, open) : a, qs: null }
  }
  let qs: Question[] | null = null
  try {
    const raw = JSON.parse(m[1]!)
    qs = (Array.isArray(raw) ? raw : [raw])
      .filter((x: any) => x && typeof x.q === 'string' && Array.isArray(x.options))
      .map((x: any) => ({
        header: x.header ? String(x.header).slice(0, 20) : undefined, q: x.q, multi: !!x.multi,
        options: x.options.map((o: any) => typeof o === 'string' ? { label: o } : { label: String(o?.label ?? ''), description: o?.description }).filter((o: QOption) => o.label),
      }))
      .filter((x: Question) => x.options.length)
      .slice(0, 6)
  } catch {}
  if (!qs?.length) return { text: a, qs: null } // not valid JSON: leave it visible rather than lose it
  return { text: (a.slice(0, m.index) + a.slice(m.index + m[0].length)).trim(), qs }
}
