/** on'yomi are written in katakana, like in every dictionary */
export const kata = (s: string) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))

/** "ひと.つ" → stem + okurigana, "-び" → suffix marker kept */
export function kun(r: string) {
  const [stem, oku = ''] = r.split('.')
  return { stem: stem!, oku }
}

// 0 new, 1 learning, 2 young, 3 mature (server: overview().status)
export const STATUS = ['New', 'Learning', 'Young', 'Mature'] as const

export const LEVELS = [5, 4, 3, 2, 1] as const

export type KanjiCard = { k: string, n: number, s: number, m: string[], on: string[], kun: string[], w: [string, string, string][] }

/** the deck is static: fetch it once per app load */
export function useKanjiDeck() {
  const deck = useState<KanjiCard[] | null>('kanji:deck', () => null)
  if (!deck.value && import.meta.client) $fetch<KanjiCard[]>('/api/kanji/deck').then(d => (deck.value = d)).catch(() => {})
  return deck
}
