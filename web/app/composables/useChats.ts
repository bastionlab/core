export interface Chat { id: string, title: string, at: number, turns: Turn[] }
const KEY = 'chat.convos'
const MAX = 40

/** conversations live in this browser only (localStorage) — nothing is sent anywhere but the local model */
export function useChats() {
  const chats = useState<Chat[]>('chats', () => [])
  const currentId = useState<string>('chats:current', () => '')
  const loaded = useState('chats:loaded', () => false)

  const load = () => {
    if (loaded.value) return
    loaded.value = true
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
      if (Array.isArray(raw)) chats.value = raw.filter(c => c?.id && Array.isArray(c.turns))
    } catch {}
    if (!chats.value.length) create()
    else currentId.value = chats.value[0]!.id
  }

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(chats.value.slice(0, MAX).map(c => ({
        ...c,
        turns: c.turns.map(({ q, a, r, model, tps, error, at }) => ({ q, a, r: r?.slice(0, 4000) ?? '', model, tps, error, at })),
      }))))
    } catch {}
  }

  function create() {
    const chat: Chat = { id: Math.random().toString(36).slice(2, 10), title: 'New chat', at: Date.now(), turns: [] }
    chats.value.unshift(chat)
    currentId.value = chat.id
    return chat
  }

  const current = computed(() => chats.value.find(c => c.id === currentId.value) ?? chats.value[0])

  function remove(id: string) {
    chats.value = chats.value.filter(c => c.id !== id)
    if (!chats.value.length) create()
    else if (currentId.value === id) currentId.value = chats.value[0]!.id
    save()
  }

  /** first question becomes the title, like every other chat app */
  function touch() {
    const c = current.value
    if (!c) return
    if (c.turns.length && (c.title === 'New chat' || !c.title)) c.title = c.turns[0]!.q.slice(0, 60)
    c.at = Date.now()
    save()
  }

  return { chats, current, currentId, create, remove, load, save, touch }
}
