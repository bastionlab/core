export interface Toast { id: number, text: string, tone?: 'ok' | 'bad' | 'warn', action?: { label: string, fn: () => void } }

/** short messages at the bottom of the screen (job finished, a change rolled back); <Toasts> in the layout shows them */
export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])
  const close = (id: number) => (toasts.value = toasts.value.filter(t => t.id !== id))
  function toast(text: string, o: Omit<Toast, 'id' | 'text'> & { ms?: number } = {}) {
    const id = Date.now() + Math.random()
    toasts.value = [...toasts.value.slice(-2), { id, text, tone: o.tone, action: o.action }]
    setTimeout(() => close(id), o.ms ?? (o.action ? 7000 : 4000))
  }
  /** optimistic change: apply now, undo + say why if the server refuses */
  async function optimistic<T>(apply: () => void, undo: () => void, save: () => Promise<T>, what = 'Change') {
    apply()
    try { return await save() } catch (e: any) {
      undo()
      toast(`${what} not saved: ${e?.data?.statusMessage || e?.statusMessage || e?.message || 'failed'}`, { tone: 'bad' })
    }
  }
  return { toasts, toast, close, optimistic }
}
