export interface Pending { name: string, args: any, label: string }

/**
 * The shared confirm card (<ActionConfirm> in the layout): the palette and anything else that offers an action
 * opens it; the agent describes what will happen, Run arms after a moment, and nothing runs before that.
 */
export function useConfirm() {
  const pending = useState<Pending | null>('confirm:pending', () => null)
  const ask = (name: string, args: any, label: string) => (pending.value = { name, args: args ?? {}, label })
  const cancel = () => (pending.value = null)
  return { pending, ask, cancel }
}
